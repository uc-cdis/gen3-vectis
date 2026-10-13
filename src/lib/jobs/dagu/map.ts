/**
 * The pure seam between Dagu's wire format and the neutral Run. Everything from Dagu is untrusted: types are checked,
 * strings are sanitised and capped, counts are bounded, times must be RFC 3339, and nothing is passed through as-is.
 *
 * Status mapping (Dagu `status` / node `status` integers, from api/v1/api.yaml; the raw `statusLabel` is kept in backend_state):
 *   run   0 not_started -> queued      1 running -> running        2 failed -> failed       3 aborted -> cancelled
 *         4 succeeded   -> succeeded   5 queued -> queued          6 partially_succeeded -> failed (not everything succeeded)
 *         7 waiting (manual action) -> running   8 rejected -> failed        anything else -> unknown
 *   node  as above, plus 5 skipped -> cancelled (did not run) and 9 retrying -> running
 * A step "cancelled" therefore means "did not run to completion for a reason that is not its own failure" (aborted, skipped,
 * upstream failed).
 */
import { isRunId, normalizeRun, normalizeTime } from '../model';
import type { Run, RunState, RunStep } from '../model';
import { sanitizeLabel, sanitizeText } from '@/lib/safe-text';
import { isObj } from '@/lib/jobs/model';
import type { Obj } from '@/lib/jobs/model';

const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

export const RUN_STATUS: Record<number, RunState> = { 0: 'queued', 1: 'running', 2: 'failed', 3: 'cancelled', 4: 'succeeded', 5: 'queued', 6: 'failed', 7: 'running', 8: 'failed' };
export const NODE_STATUS: Record<number, RunState> = { ...RUN_STATUS, 5: 'cancelled', 9: 'running' };
/** Dagu run statuses that make up each neutral state (used to filter a list upstream). */
export const statusesFor = (s: RunState): number[] => Object.keys(RUN_STATUS).map(Number).filter((k) => RUN_STATUS[k] === s);

const stateOf = (table: Record<number, RunState>, v: unknown): RunState => (typeof v === 'number' && Number.isInteger(v) && Object.prototype.hasOwnProperty.call(table, v) ? table[v] : 'unknown');

export const DAG_NAME = /^[A-Za-z0-9_-]{1,64}$/;
export const DAG_RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const STEP_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Neutral run id = `<dag name>.<dagu run id>`. Strict on both parts; `latest` is Dagu's alias for "the newest run" and is never accepted. */
export function composeRunId(name: string, dagRunId: string): string { return `${name}.${dagRunId}`; }
export function parseRunId(id: unknown): { name: string; dagRunId: string } | null {
  if (!isRunId(id)) return null;
  const m = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{1,64})$/.exec(id);
  if (!m || m[2].toLowerCase() === 'latest') return null;
  return { name: m[1], dagRunId: m[2] };
}

// ---------------------------------------------------------------- ownership labels (the portal's identity for a run)
export const OWNER_KEY = 'vectis.owner';
export const SUBMITTER_KEY = 'vectis.submitted_by';
const LABEL_KV = /^([A-Za-z0-9._-]{1,128})=([A-Za-z0-9._/-]{0,256})$/;

/** Parse Dagu's `labels` ("k=v" strings, lower-cased by Dagu) into a map. Bad entries are dropped; at most 64. */
export function labelMap(v: unknown): { map: Record<string, string>; owners: string[] } {
  const map: Record<string, string> = Object.create(null);
  const owners: string[] = [];
  for (const l of arr(v, 64)) {
    if (typeof l !== 'string') continue;
    const m = LABEL_KV.exec(l);
    if (!m) continue;
    if (m[1] === OWNER_KEY) { owners.push(m[2]); continue; }
    if (m[1] !== '__proto__') map[m[1]] = m[2];
  }
  return { map: { ...map }, owners };
}
/** True only when the run carries EXACTLY ONE portal owner label and it equals the caller's. Anything else is not the caller's run. */
export function ownedBy(labels: unknown, ownerHash: string): boolean {
  const { owners } = labelMap(labels);
  return owners.length === 1 && owners[0] === ownerHash;
}

// ---------------------------------------------------------------- text helpers
/** Dagu error text may name files on the Dagu host. Absolute server paths are replaced; the message otherwise stays. */
export const redactPaths = (s: string): string => s.replace(/(?<![\w:/.-])\/(?:var|tmp|home|opt|etc|usr|root|data|srv|run|app|mnt|proc)\/[^\s"'<>]*/g, (m) => `<path>${/[:;,.)]+$/.exec(m)?.[0] ?? ''}`);
const err = (v: unknown): string | null => (typeof v === 'string' && v ? sanitizeText(redactPaths(v), 4096) : null);

/** "k=v k2=\"v 2\"" -> map. Only what the portal itself sent is expected here; anything odd is ignored. */
export function parseParams(v: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (typeof v !== 'string') return {};
  let n = 0;
  for (const m of v.slice(0, 8192).matchAll(/([A-Za-z_][A-Za-z0-9_]{0,63})=("[^"]{0,1024}"|\S{0,1024})/g)) {
    if (n++ >= 32) break;
    if (m[1] === '__proto__') continue;
    out[m[1]] = sanitizeLabel(m[2].replace(/^"|"$/g, ''), 256);
  }
  return { ...out };
}

const commandOf = (step: Obj): string[] => {
  const first = arr(step.commands, 1)[0];
  if (!isObj(first)) return [];
  const argv = [typeof first.command === 'string' ? first.command : '', ...arr(first.args, 64).filter((a): a is string => typeof a === 'string')].filter((a, i) => i > 0 || a !== '');
  return argv.slice(0, 64).map((a) => sanitizeText(a, 4096));
};
const executorOf = (step: Obj): string => {
  const ec = isObj(step.executorConfig) ? step.executorConfig : null;
  const t = ec && typeof ec.type === 'string' ? ec.type : '';
  const cfg = ec && isObj(ec.config) ? ec.config : null;
  if (t === 'docker' && cfg && typeof cfg.image === 'string') return sanitizeLabel(cfg.image, 512);
  return sanitizeLabel(t || 'command', 64);
};

export interface StepLog { stdout: string; stderr: string; truncated: boolean }

/** A node -> a neutral step. `logs` is what was fetched for it (empty for a summary). */
export function mapNode(raw: unknown, index: number, logs?: StepLog): RunStep {
  const n = isObj(raw) ? raw : {};
  const step = isObj(n.step) ? n.step : {};
  const state = stateOf(NODE_STATUS, n.status);
  const error = err(n.error);
  const exit = state === 'succeeded' ? 0 : state === 'failed' && error ? (/exit status (\d{1,3})\b/.exec(error)?.[1] ?? null) : null;
  return {
    index,
    name: sanitizeLabel(typeof step.name === 'string' && step.name ? step.name : step.id, 128),
    depends_on: arr(step.depends, 64).filter((d): d is string => typeof d === 'string').map((d) => sanitizeLabel(d, 128)).filter(Boolean),
    state, error, logs_loaded: logs !== undefined || normalizeTime(n.startedAt) === null,
    image: executorOf(step),
    command: commandOf(step),
    exit_code: exit === null ? null : Number(exit),
    started_at: normalizeTime(n.startedAt), ended_at: normalizeTime(n.finishedAt),
    stdout: logs?.stdout ?? '', stderr: logs?.stderr ?? '', truncated: logs?.truncated ?? false,
  };
}

/** What Dagu said about one run (summary or details) -> neutral Run, or null when it is not a usable record. */
export function fromDagu(raw: unknown, logsFor?: (stepName: string) => StepLog | undefined): Run | null {
  if (!isObj(raw) || typeof raw.name !== 'string' || typeof raw.dagRunId !== 'string' || !DAG_NAME.test(raw.name) || !DAG_RUN_ID.test(raw.dagRunId)) return null;
  const { map: tags } = labelMap(raw.labels);
  const nodes = arr(raw.nodes, 64);
  const steps = nodes.map((nd, i) => {
    const name = isObj(nd) && isObj(nd.step) ? (typeof nd.step.name === 'string' ? nd.step.name : '') : '';
    return mapNode(nd, i, logsFor?.(name));
  });
  const state = stateOf(RUN_STATUS, raw.status);
  const params = parseParams(raw.params);
  const run: Run = {
    id: composeRunId(raw.name, raw.dagRunId),
    backend: 'dagu',
    name: raw.name,
    job: tags['vectis.job'] ?? null,
    submitted_by: tags[SUBMITTER_KEY] ?? null,
    state,
    backend_state: sanitizeLabel(raw.statusLabel, 64),
    created_at: normalizeTime(raw.queuedAt) ?? normalizeTime(raw.startedAt),
    started_at: normalizeTime(raw.startedAt),
    ended_at: normalizeTime(raw.finishedAt),
    steps,
    inputs: [], outputs: [], resources: null,
    tags, params,
    ...(err(raw.error) ? { error: err(raw.error) } : {}),
  };
  return normalizeRun(run);
}

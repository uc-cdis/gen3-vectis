/**
 * The runner-neutral run model. The UI renders ONLY these types; a Runner (TES today; others slot in via the Runner interface) maps its own
 * wire format into a Run on the server, and `normalizeRun` re-validates it in the browser (defence in depth).
 * Missing data is null, never 0 and never "success".
 */
import { sanitizeLabel, sanitizeLogText, sanitizeText } from '@/lib/safe-text';

export const RUN_STATES = ['queued', 'starting', 'running', 'succeeded', 'failed', 'cancelled', 'unknown'] as const;
export type RunState = (typeof RUN_STATES)[number];
/** Finished for good. `unknown` is NOT terminal: it may still resolve, so it is polled like an active run. */
export const TERMINAL: readonly RunState[] = ['succeeded', 'failed', 'cancelled'];
/** The id of the runner that produced the run ('tes' today). */
type Backend = string;
const BACKEND_ID = /^[a-z][a-z0-9_-]{0,31}$/;
export const DETAILS = ['summary', 'full'] as const;
export type Detail = (typeof DETAILS)[number];

export interface RunStep {
  index: number;
  /** the step's own name/id in a workflow engine (Dagu); '' for a sequential runner (TES), where the UI says "Step N" */
  name: string;
  /** names of the steps this one waits for. Empty for TES (steps run in order); for a DAG, the dependency edges */
  depends_on: string[];
  /** the step's own state when the runner reports one (Dagu); null for TES, where the UI derives it from exit_code */
  state: RunState | null;
  /** the step's own failure text when the runner gives one (sanitised, capped); null otherwise */
  error: string | null;
  /** false when this step started but its stdout/stderr were not fetched (a workflow runner fetches logs for failed/running steps by default); ask for them with the `step` query. Always true for TES. */
  logs_loaded: boolean;
  image: string;
  command: string[];
  exit_code: number | null;
  started_at: string | null;
  ended_at: string | null;
  stdout: string;
  stderr: string;
  /** stdout or stderr was cut by the server */
  truncated: boolean;
}
interface RunInput { name: string; url: string | null; path: string }
interface RunOutput { name: string; url: string; path: string; size_bytes: number | null }
interface RunResources { cpu_cores?: number; ram_gb?: number; disk_gb?: number; preemptible?: boolean }
export interface Run {
  id: string;
  backend: Backend;
  name: string;
  description?: string;
  /** catalog job id, or null for a run that did not come from the catalog */
  job: string | null;
  /** from the portal-verified tag, else null */
  submitted_by: string | null;
  state: RunState;
  /** the runner's own state word, shown as secondary text */
  backend_state: string;
  created_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  steps: RunStep[];
  inputs: RunInput[];
  outputs: RunOutput[];
  resources: RunResources | null;
  tags: Record<string, string>;
  /** the parameter values the run was started with (workflow runners); absent for TES */
  params?: Record<string, string>;
  system_logs?: string[];
  error?: string | null;
}
export interface RunList { runs: Run[]; next_page_token: string | null }
export interface StorageSetup { bucket: string | null; region: string | null; endpoint: string | null }
export interface ServiceInfo { name?: string; version?: string }

export const isTerminal = (s: RunState): boolean => TERMINAL.includes(s);
/** A run that can still change is worth polling. */
export const isActive = (r: Pick<Run, 'state'>): boolean => !isTerminal(r.state);
const CANCELLABLE: readonly RunState[] = ['queued', 'starting', 'running'];
export const isCancellable = (s: RunState): boolean => CANCELLABLE.includes(s);

const RUN_ID = /^[A-Za-z0-9._-]{1,128}$/;
export const isRunId = (s: unknown): s is string => typeof s === 'string' && RUN_ID.test(s) && s !== '.' && s !== '..';

// ------------------------------------------------------------------ normalisation (untrusted -> Run)
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const objs = (v: unknown, max: number): Obj[] => list(v, max).filter(isObj);
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;

export function normalizeTime(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40 || !RFC3339.test(v)) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}
export function strMap(v: unknown, maxEntries: number, maxVal = 256): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!isObj(v)) return {};
  for (const k of Object.keys(v).slice(0, maxEntries)) {
    if (k === '__proto__') continue;
    const val = v[k];
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') out[sanitizeLabel(k, 128)] = sanitizeLabel(String(val), maxVal);
  }
  return { ...out };
}
const oneOf = <T extends string>(set: readonly T[], v: unknown, fallback: T): T => (typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : fallback);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function normalizeRun(raw: unknown): Run | null {
  if (!isObj(raw) || !isRunId(raw.id)) return null;
  const steps = objs(raw.steps, 64).map((s, i) => {
    const o = sanitizeLogText(s.stdout);
    const e = sanitizeLogText(s.stderr);
    const nm = sanitizeLabel(s.name, 128);
    return {
      index: i, name: nm, depends_on: list(s.depends_on, 64).filter((d): d is string => typeof d === 'string').map((d) => sanitizeLabel(d, 128)).filter(Boolean),
      state: typeof s.state === 'string' && (RUN_STATES as readonly string[]).includes(s.state) ? (s.state as RunState) : null,
      error: typeof s.error === 'string' && s.error ? sanitizeText(s.error, 4096) : null,
      logs_loaded: s.logs_loaded !== false,
      image: sanitizeLabel(s.image, 512),
      command: list(s.command, 256).filter((c): c is string => typeof c === 'string').map((c) => sanitizeText(c, 4096)),
      exit_code: typeof s.exit_code === 'number' && Number.isInteger(s.exit_code) ? s.exit_code : null,
      started_at: normalizeTime(s.started_at), ended_at: normalizeTime(s.ended_at),
      stdout: o.text, stderr: e.text, truncated: s.truncated === true || o.truncated || e.truncated,
    };
  });
  let resources: RunResources | null = null;
  if (isObj(raw.resources)) {
    const r = raw.resources;
    resources = { cpu_cores: num(r.cpu_cores), ram_gb: num(r.ram_gb), disk_gb: num(r.disk_gb), preemptible: typeof r.preemptible === 'boolean' ? r.preemptible : undefined };
  }
  const tags = strMap(raw.tags, 64);
  return {
    id: raw.id,
    backend: typeof raw.backend === 'string' && BACKEND_ID.test(raw.backend) ? raw.backend : 'unknown',
    name: sanitizeLabel(raw.name, 256),
    ...(typeof raw.description === 'string' && raw.description ? { description: sanitizeText(raw.description, 4096) } : {}),
    job: typeof raw.job === 'string' && raw.job ? sanitizeLabel(raw.job, 128) : null,
    submitted_by: typeof raw.submitted_by === 'string' && raw.submitted_by ? sanitizeLabel(raw.submitted_by, 256) : null,
    state: oneOf(RUN_STATES, raw.state, 'unknown'),
    backend_state: sanitizeLabel(raw.backend_state, 64),
    created_at: normalizeTime(raw.created_at), started_at: normalizeTime(raw.started_at), ended_at: normalizeTime(raw.ended_at),
    steps,
    inputs: objs(raw.inputs, 64).map((i) => ({ name: sanitizeLabel(i.name, 256), url: typeof i.url === 'string' && i.url ? sanitizeLabel(i.url, 2048) : null, path: sanitizeLabel(i.path, 1024) })),
    outputs: objs(raw.outputs, 64).map((o) => ({
      name: sanitizeLabel(o.name, 256), url: sanitizeLabel(o.url, 2048), path: sanitizeLabel(o.path, 1024),
      size_bytes: typeof o.size_bytes === 'number' && Number.isSafeInteger(o.size_bytes) && o.size_bytes >= 0 ? o.size_bytes : null,
    })),
    resources, tags,
    ...(isObj(raw.params) ? { params: strMap(raw.params, 32, 256) } : {}),
    ...(Array.isArray(raw.system_logs) ? { system_logs: list(raw.system_logs, 256).filter((s): s is string => typeof s === 'string').map((s) => sanitizeText(s, 4096)) } : {}),
    ...(typeof raw.error === 'string' ? { error: sanitizeText(raw.error, 4096) } : {}),
  };
}

export function normalizeRunList(raw: unknown): RunList | null {
  if (!isObj(raw)) return null;
  const runs = list(raw.runs, 2048).map(normalizeRun).filter((r): r is Run => r !== null);
  const tok = typeof raw.next_page_token === 'string' && raw.next_page_token.length > 0 && raw.next_page_token.length <= 2048 && /^[\x21-\x7e]+$/.test(raw.next_page_token) ? raw.next_page_token : null;
  return { runs, next_page_token: tok };
}

/** A runner's storage-setup answer has additionalProperties:true; expose ONLY bucket, region and endpoint (short printable strings). */
export function normalizeStorageSetup(raw: unknown): StorageSetup | null {
  if (!isObj(raw)) return null;
  const get = (...ks: string[]): string | null => {
    for (const k of ks) { const v = raw[k]; if (typeof v === 'string' && v.length > 0 && v.length <= 256 && /^[\x21-\x7e]+$/.test(v)) return v; }
    return null;
  };
  return { bucket: get('bucket', 'bucket_name', 'user_bucket', 'name'), region: get('region', 'bucket_region'), endpoint: get('endpoint', 'endpoint_url', 's3_endpoint') };
}

/** Only name and version are ever shown; everything else a service reports is dropped. */
export function normalizeServiceInfo(raw: unknown): ServiceInfo | null {
  if (!isObj(raw)) return null;
  const name = typeof raw.name === 'string' ? sanitizeLabel(raw.name, 128) : '';
  const version = typeof raw.version === 'string' ? sanitizeLabel(raw.version, 64) : '';
  return { ...(name ? { name } : {}), ...(version ? { version } : {}) };
}

/** A parsed-JSON/YAML mapping. The runners and the catalog read untrusted documents with this one guard. */
export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

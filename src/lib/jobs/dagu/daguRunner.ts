/**
 * The Dagu runner. Dagu (https://github.com/dagucloud/dagu, GPL-3.0) is only ever a SEPARATE server that this file talks to
 * over its documented REST API (/api/v1); none of its code or UI is copied, linked or embedded.
 *
 * Calls used (the whole surface; nothing else is ever sent):
 *   POST /dag-runs                                  create + start a run from an INLINE spec (no DAG file is stored on the server)
 *   GET  /dag-runs?labels=&status=&limit=&cursor=   list
 *   GET  /dag-runs/{name}/{id}                      status + nodes
 *   GET  /dag-runs/{name}/{id}/steps/{step}/log     step output (?stream=stderr&head=N)
 *   POST /dag-runs/{name}/{id}/stop                 cancel
 *   GET  /health                                    version
 * No create-DAG, delete, retry, edit, approve, user or key endpoint is reachable from here.
 *
 * OWNERSHIP. Dagu runs everything as ONE service identity, so the portal enforces per-user access itself:
 *  - every run is created with the label `vectis.owner=<sha256 of the verified user>` (Dagu labels cannot hold an e-mail, and
 *    a hash cannot collide the way a lossy "safe" form of the name could). Only the portal sets it; a catalog definition may not
 *    declare `vectis.*` labels (lint) and a client can only send catalog id + params.
 *  - list asks Dagu to filter by that label AND re-checks every run it gets back; get/cancel read the run first and answer 404
 *    unless it carries exactly one owner label equal to the caller's. Runs created by anyone else are indistinguishable from runs that do not exist.
 *  - the user's own bearer is never sent to Dagu (it knows nothing about it); the service credential never leaves this file.
 *
 * IDEMPOTENT SUBMIT. The portal chooses the run id (128 random bits). A POST that is repeated with the same id is refused by
 * Dagu with 409 (verified), so a retry can never start a second run; if the answer to the POST is lost the runner looks the
 * run up by that id and, if it exists and is the caller's, reports success.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { parse as parseYaml, stringify } from 'yaml';
import { MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS } from '../portal';
import { callUpstream } from '@/lib/upstream';
import type { LaunchSpec } from '../launch';
import { normalizeServiceInfo } from '../model';
import type { Run, RunList } from '../model';
import { RunnerError } from '../runner';
import type { RunQuery, Runner, RunnerContext } from '../runner';
import { sanitizeLabel, sanitizeLogText } from '@/lib/safe-text';
import { daguTarget } from './config';
import type { DaguTarget } from './config';
import { lintDaguDefinition } from './lint';
import { DAG_NAME, DAG_RUN_ID, OWNER_KEY, STEP_NAME, SUBMITTER_KEY, composeRunId, fromDagu, ownedBy, parseRunId, statusesFor } from './map';
import type { StepLog } from './map';
import { assertInertValues } from './params';
import { isObj } from '@/lib/jobs/model';

type Env = Record<string, string | undefined>;

const LOG_HEAD_LINES = 2000;
const LOG_RESPONSE_BYTES = 2 * 1024 * 1024;
const LOG_CONCURRENCY = 6;
const MAX_LIST = 500;
const LABEL_VALUE = /[^a-z0-9_./-]/g;

/** HMAC-SHA256 (hex) of the verified user under JOBS_OWNER_HMAC_KEY: a label nobody can compute without the portal's key. */
export const ownerHash = (user: string, key: string): string => createHmac('sha256', key).update(user, 'utf8').digest('hex');
const MIN_OWNER_KEY_BYTES = 32;
/** Overall time budget of one get(): the run read plus every log fetch. */
export const GET_DEADLINE_MS = 20_000;
const DEFAULT_LOG_STEPS = 8;
/** Dagu label values allow only a-z 0-9 - _ . / (and lower-case them): a lossy display form of the verified user. */
const displayUser = (user: string): string => user.toLowerCase().replace(LABEL_VALUE, '_').slice(0, 64) || 'unknown';
const labelValue = (v: string): string => v.toLowerCase().replace(LABEL_VALUE, '_').slice(0, 128);

// ---------------------------------------------------------------- upstream
type Called = { ok: true; status: number; payload: unknown } | { ok: false; status: number; error: string };

/** What the portal says for a Dagu status. Dagu's own message is never echoed (it can name files or internals). */
function publicError(status: number): { status: number; error: string } {
  if (status === 404) return { status: 404, error: 'Run not found.' };
  if (status === 409) return { status: 409, error: 'This run has already finished or already exists.' };
  if (status === 429) return { status: 429, error: 'The workflow service is busy. Try again in a moment.' };
  if (status === 400 || status === 422) return { status: 400, error: 'The workflow service refused the request.' };
  if (status === 401 || status === 403) return { status: 502, error: 'The workflow service refused the portal.' }; // the portal's own credential: not the user's problem, and not a 401 that would sign them out
  return { status: 502, error: 'The workflow service returned an error.' };
}

/** One call: the service credential only (no cookie, no user token). `deadline` (epoch ms) bounds a whole multi-call operation. */
async function callDagu(t: DaguTarget, method: 'GET' | 'POST', path: string, body?: unknown, cap = MAX_RESPONSE_BYTES, deadline?: number): Promise<Called> {
  const ms = deadline === undefined ? UPSTREAM_TIMEOUT_MS : Math.min(UPSTREAM_TIMEOUT_MS, deadline - Date.now());
  if (ms <= 0) return { ok: false, status: 504, error: 'The workflow service took too long to respond.' };
  const r = await callUpstream(`${t.base}/api/v1${path}`, {
    method,
    headers: { accept: 'application/json', authorization: t.authorization, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, { timeoutMs: ms, maxBytes: cap });
  switch (r.kind) {
    case 'ok': return { ok: true, status: r.status, payload: r.payload };
    case 'rejected': return { ok: false, ...publicError(r.status) };
    case 'too-large': return { ok: false, status: 502, error: 'The workflow service returned too much data.' };
    case 'unreadable': return { ok: false, status: 502, error: 'The workflow service returned an unreadable response.' };
    case 'timeout': return { ok: false, status: 504, error: 'The workflow service took too long to respond.' };
    case 'unreachable': return { ok: false, status: 502, error: 'The workflow service could not be reached.' };
  }
}

const unreadable = () => new RunnerError(502, 'The workflow service returned an unreadable response.');

export function createDaguRunner(getEnv: () => Env = () => process.env): Runner {
  const target = (): DaguTarget => {
    const t = daguTarget(getEnv());
    if (!t) throw new RunnerError(503, 'The jobs service is not configured.');
    return t;
  };
  const who = (ctx: RunnerContext): string => {
    const key = getEnv().JOBS_OWNER_HMAC_KEY;
    if (typeof key !== 'string' || Buffer.byteLength(key, 'utf8') < MIN_OWNER_KEY_BYTES) throw new RunnerError(503, 'The jobs service is not configured (JOBS_OWNER_HMAC_KEY is missing or shorter than 32 bytes).');
    if (typeof ctx.user !== 'string' || ctx.user.trim() === '') throw new RunnerError(403, 'No verified identity.');
    return ownerHash(ctx.user, key);
  };
  async function ok(t: DaguTarget, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const out = await callDagu(t, method, path, body);
    if (!out.ok) throw new RunnerError(out.status, out.error);
    return out.payload;
  }

  /** The run `id` if it exists AND is the caller's; otherwise a 404 that is identical for "not yours" and "does not exist". */
  async function ownRun(t: DaguTarget, id: string, owner: string, deadline?: number): Promise<{ name: string; dagRunId: string; details: Record<string, unknown> }> {
    const p = parseRunId(id);
    if (!p) throw new RunnerError(400, 'Invalid run id.');
    const out = await callDagu(t, 'GET', `/dag-runs/${p.name}/${p.dagRunId}`, undefined, MAX_RESPONSE_BYTES, deadline);
    if (!out.ok) throw new RunnerError(out.status === 404 ? 404 : out.status, out.error);
    const d = isObj(out.payload) && isObj(out.payload.dagRunDetails) ? out.payload.dagRunDetails : null;
    if (!d) throw unreadable();
    // the answer must be about the run that was asked for (never Dagu's "latest" alias) and must carry the caller's owner label
    if (d.name !== p.name || d.dagRunId !== p.dagRunId || !ownedBy(d.labels, owner)) throw new RunnerError(404, 'Run not found.');
    return { ...p, details: d };
  }

  /**
   * Logs are fetched for the steps asked for, else for the steps that matter (failed, running, retrying; at most 8), never for
   * "everything": a 64-step DAG would otherwise be 128 requests per page view. All of it shares ONE deadline.
   */
  async function fetchLogs(t: DaguTarget, name: string, dagRunId: string, details: Record<string, unknown>, wanted: string[] | undefined, deadline: number): Promise<Map<string, StepLog>> {
    const out = new Map<string, StepLog>();
    const candidates: Array<{ step: string; hot: boolean }> = [];
    for (const n of (Array.isArray(details.nodes) ? details.nodes : []).slice(0, 64)) {
      if (!isObj(n) || !isObj(n.step) || typeof n.step.name !== 'string' || !STEP_NAME.test(n.step.name)) continue;
      if (typeof n.startedAt !== 'string' || n.startedAt === '') continue; // never started: no log
      candidates.push({ step: n.step.name, hot: n.status === 1 || n.status === 2 || n.status === 9 });
    }
    const steps = (wanted ? candidates.filter((c) => wanted.includes(c.step)) : candidates.filter((c) => c.hot)).slice(0, wanted ? 8 : DEFAULT_LOG_STEPS).map((c) => c.step);
    const one = async (step: string, stream: 'stdout' | 'stderr') => {
      const r = await callDagu(t, 'GET', `/dag-runs/${name}/${dagRunId}/steps/${step}/log?stream=${stream}&head=${LOG_HEAD_LINES}`, undefined, LOG_RESPONSE_BYTES, deadline);
      if (!r.ok) return { text: '', truncated: r.status === 502 };
      const p = r.payload;
      const s = sanitizeLogText(isObj(p) ? p.content : '');
      return { text: s.text, truncated: s.truncated || (isObj(p) && p.hasMore === true) };
    };
    const jobs = steps.flatMap((s) => [() => one(s, 'stdout').then((v) => [s, 'stdout', v] as const), () => one(s, 'stderr').then((v) => [s, 'stderr', v] as const)]);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(LOG_CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) {
        const [s, stream, v] = await jobs[next++]();
        const cur = out.get(s) ?? { stdout: '', stderr: '', truncated: false };
        cur[stream] = v.text; cur.truncated = cur.truncated || v.truncated;
        out.set(s, cur);
      }
    }));
    return out;
  }

  return {
    id: 'dagu',

    async submit(spec: LaunchSpec, ctx) {
      const t = target();
      const owner = who(ctx);
      const dag = spec.dag;
      if (!dag || dag.engine !== 'dagu') throw new RunnerError(400, 'The active jobs runner (Dagu) runs workflow jobs only; this job is not one.');
      const env = getEnv();
      // the definition is linted AGAIN here with this server's environment (the executor allowlist is operator policy)
      const lint = lintDaguDefinition(dag.definition, { env, catalogParams: Object.keys(dag.params) });
      if (!lint.ok) throw new RunnerError(400, 'The workflow definition was refused.', lint.errors);
      const bad = assertInertValues(dag.params);
      if (bad) throw new RunnerError(400, 'The parameters were refused.', [bad]);
      const name = lint.info.name ?? dag.dag_name;
      if (!DAG_NAME.test(name)) throw new RunnerError(400, 'The workflow name is not allowed.');

      // labels: only what the portal itself decides. spec.tags is read through an allowlist; any other key (including a
      // client-looking vectis.*) is dropped, and the owner/submitter labels are always set last from the verified user.
      const labels: string[] = [];
      for (const k of ['vectis.job', 'vectis.catalog_sha', 'vectis.catalog_repo'] as const) {
        const v = spec.tags?.[k];
        if (typeof v === 'string' && v) labels.push(`${k}=${labelValue(v)}`);
      }
      labels.push(`${SUBMITTER_KEY}=${displayUser(ctx.user)}`, `${OWNER_KEY}=${owner}`);

      const dagRunId = randomBytes(16).toString('base64url'); // 22 chars of [A-Za-z0-9_-]
      if (!DAG_RUN_ID.test(dagRunId) || dagRunId === 'latest') throw new RunnerError(500, 'The jobs service had a problem.');
      // Dagu receives a document RE-SERIALISED from the parsed, linted object, never the original bytes: what was checked is exactly what runs
      const wire = stringify(lint.info.doc, { lineWidth: 0, schema: 'yaml-1.1' });
      if (JSON.stringify(parseYaml(wire)) !== JSON.stringify(lint.info.doc)) throw new RunnerError(500, 'The jobs service had a problem.'); // round trip must be exact
      const body = { spec: wire, name, params: JSON.stringify(dag.params), dagRunId, labels };

      const out = await callDagu(t, 'POST', '/dag-runs', body);
      if (!out.ok) {
        if (out.status === 502 || out.status === 504) {
          // the answer may have been lost after Dagu accepted it: if the run exists and is ours, it is not a failure
          try { await ownRun(t, composeRunId(name, dagRunId), owner); return { id: composeRunId(name, dagRunId), warnings: spec.warnings }; } catch { /* not created */ }
        }
        throw new RunnerError(out.status === 409 ? 502 : out.status, out.status === 400 || out.status === 422 ? 'The workflow service refused the definition or parameters.' : out.error);
      }
      const rid = isObj(out.payload) ? out.payload.dagRunId : undefined;
      if (rid !== dagRunId) throw unreadable();
      return { id: composeRunId(name, dagRunId), warnings: spec.warnings };
    },

    async list(q: RunQuery, ctx): Promise<RunList> {
      const t = target();
      const owner = who(ctx);
      const params = new URLSearchParams();
      params.append('labels', `${OWNER_KEY}=${owner}`);
      params.set('limit', String(Math.min(q.page_size ?? 25, MAX_LIST)));
      if (q.page_token !== undefined) params.set('cursor', q.page_token);
      if (q.state) for (const s of statusesFor(q.state)) params.append('status', String(s));
      if (q.state && statusesFor(q.state).length === 0) return { runs: [], next_page_token: null };
      const payload = await ok(t, 'GET', `/dag-runs?${params.toString()}`);
      if (!isObj(payload) || !Array.isArray(payload.dagRuns)) throw unreadable();
      let runs: Run[] = [];
      for (const r of payload.dagRuns.slice(0, MAX_LIST)) {
        if (!isObj(r) || !ownedBy(r.labels, owner)) continue; // never trust the upstream filter
        const run = fromDagu(r);
        if (run) runs.push(run);
      }
      if (q.state) runs = runs.filter((r) => r.state === q.state);
      if (q.name_prefix !== undefined) runs = runs.filter((r) => r.name.startsWith(q.name_prefix as string));
      for (let i = 0; i < (q.tag_key?.length ?? 0); i++) {
        const k = (q.tag_key as string[])[i];
        const v = q.tag_value?.[i];
        runs = runs.filter((r) => Object.prototype.hasOwnProperty.call(r.tags, k) && (v === undefined || r.tags[k] === v));
      }
      const c = payload.nextCursor;
      return { runs, next_page_token: typeof c === 'string' && c.length > 0 && c.length <= 512 && /^[\x21-\x7e]+$/.test(c) ? c : null };
    },

    async get(id, ctx, opts): Promise<Run> {
      const t = target();
      const deadline = Date.now() + GET_DEADLINE_MS;
      const own = await ownRun(t, id, who(ctx), deadline);
      const full = (opts?.detail ?? 'full') === 'full';
      const logs = full ? await fetchLogs(t, own.name, own.dagRunId, own.details, opts?.steps, deadline) : new Map<string, StepLog>();
      const run = fromDagu(own.details, (s) => logs.get(s));
      if (!run) throw unreadable();
      return run;
    },

    async cancel(id, ctx) {
      const t = target();
      const own = await ownRun(t, id, who(ctx));
      const run = fromDagu(own.details);
      if (!run) throw unreadable();
      if (run.state === 'succeeded' || run.state === 'failed' || run.state === 'cancelled') throw new RunnerError(409, 'This run has already finished.');
      await ok(t, 'POST', `/dag-runs/${own.name}/${own.dagRunId}/stop`);
    },

    async info() {
      const t = target();
      const p = await ok(t, 'GET', '/health');
      if (!isObj(p)) throw unreadable();
      return normalizeServiceInfo({ name: 'Dagu', version: typeof p.version === 'string' ? sanitizeLabel(p.version, 64) : undefined });
    },
  };
}

export const daguRunner: Runner = createDaguRunner();

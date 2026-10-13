/**
 * The GA4GH TES runner (gen3-workflow). All TES-specific server behaviour lives here: base URL checks, exact upstream
 * paths, query building, the image allowlist and task policy (`prepareTask`), upstream calls (no redirects, size/time caps,
 * no upstream detail leaked) and the mapping of TES tasks to the neutral Run. The browser never reaches TES.
 *
 * The user's OWN bearer token is forwarded (cookies and identity headers never), so gen3-workflow enforces per-user
 * task access itself; the portal gates in portal.ts are an extra layer.
 */
import { MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS, isProduction } from '../portal';
import { imageAllowed } from '../images';
import { callUpstream } from '@/lib/upstream';
import { lintTask } from '../jobdef/lint';
import type { LaunchSpec } from '../launch';
import { isRunId, normalizeServiceInfo, normalizeStorageSetup } from '../model';
import type { Detail, Run, RunList } from '../model';
import { RunnerError } from '../runner';
import type { RunQuery, Runner, RunnerContext } from '../runner';
import { sanitizeLabel } from '@/lib/safe-text';
import { fromTesTask, tesStatesFor, toTesTask } from './adapter';
import { normalizeTask, normalizeTaskList } from './normalize';
import type { TesTaskSubmission } from './types';
import { LIMITS, stripReadOnly, validateTaskSubmission } from './validate';

type Env = Record<string, string | undefined>;

type TesTarget =
  | { kind: 'service-info' }
  | { kind: 'storage-setup' }
  | { kind: 'list' }
  | { kind: 'create' } // internal only (submit); never reachable from a client path
  | { kind: 'get'; id: string }
  | { kind: 'cancel'; id: string };

// ---------------------------------------------------------------- upstream
function base(name: 'TES_SERVICE_URL' | 'TES_STORAGE_URL', env: Env = process.env): string | null {
  const v = env[name]?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.username || u.password || u.search || u.hash) return null;
    if (u.protocol !== 'https:' && !(!isProduction(env) && u.protocol === 'http:')) return null;
    return v.replace(/\/+$/, '');
  } catch { return null; }
}
export const upstreamUrl = (route: TesTarget, qs: string, env?: Record<string, string | undefined>): string | null => {
  if (route.kind === 'storage-setup') { const b = base('TES_STORAGE_URL', env); return b ? `${b}/storage/setup` : null; }
  const b = base('TES_SERVICE_URL', env);
  if (!b) return null;
  switch (route.kind) {
    case 'service-info': return `${b}/service-info`;
    case 'list': case 'create': return `${b}/tasks${qs}`;
    case 'get': return `${b}/tasks/${route.id}${qs}`;
    case 'cancel': return `${b}/tasks/${route.id}:cancel`;
  }
};
/** Built from scratch: the user's own bearer token, nothing else from the browser. Cookies are never forwarded. */
function tesHeaders(access: { token: string }, hasBody: boolean): Record<string, string> {
  return { accept: 'application/json', authorization: `Bearer ${access.token}`, ...(hasBody ? { 'content-type': 'application/json' } : {}) };
}
const CLIENT_ERROR = new Set([400, 401, 403, 404, 409, 413, 422, 429]);
function tesPublicError(status: number, payload: unknown): { status: number; body: { error: string } } {
  if (status >= 500 || !CLIENT_ERROR.has(status)) return { status: status >= 500 ? 502 : 400, body: { error: 'The jobs service returned an error.' } };
  const p = payload as { message?: unknown; error?: unknown; detail?: unknown } | null;
  const raw = [p?.message, p?.error, p?.detail].find((v) => typeof v === 'string');
  const msg = sanitizeLabel(raw ?? `Request failed (${status}).`, 200);
  return { status, body: { error: msg || `Request failed (${status}).` } };
}

// ---------------------------------------------------------------- task submission policy
type Prepared = { ok: true; task: TesTaskSubmission } | { ok: false; status: number; error: string; details?: string[] };

export { imageAllowed };
const SUBMITTER = /[^\x20-\x7e]/g;

/**
 * Everything a compiled task must pass before it is sent. Only server-compiled catalog tasks reach this
 * (there is no raw-create route); client-looking `vectis.*` tags other than the three catalog ones are dropped anyway.
 */
export function prepareTask(raw: unknown, user: string, opts: { declaredSecrets?: ReadonlySet<string>; env?: Env } = {}): Prepared {
  const env = opts.env ?? process.env;
  const v = validateTaskSubmission(stripReadOnly(raw));
  if (!v.ok) return { ok: false, status: 400, error: 'The task is not valid.', details: v.errors };
  const task: TesTaskSubmission = { ...v.task };
  const lint = lintTask(task, { allowSecretRefs: true, declaredSecrets: opts.declaredSecrets ?? new Set() });
  if (lint.length) return { ok: false, status: 400, error: 'The task was refused.', details: lint.map((i) => `${i.path}: ${i.message}`) };
  for (const x of task.executors) {
    const ok = imageAllowed(x.image, env);
    if (ok === 'not-configured') return { ok: false, status: 403, error: 'Task creation is not enabled on this deployment.' };
    if (!ok) return { ok: false, status: 403, error: 'This container image is not allowed.' };
  }
  const tags: Record<string, string> = {};
  for (const [k, val] of Object.entries(task.tags ?? {})) {
    if (!k.toLowerCase().startsWith('vectis.')) tags[k] = val;
    else if (['vectis.job', 'vectis.catalog_sha', 'vectis.catalog_repo'].includes(k)) tags[k] = val;
  }
  tags['vectis.submitted_by'] = user.replace(SUBMITTER, '?').slice(0, 256);
  if (Object.keys(tags).length > LIMITS.tags) return { ok: false, status: 400, error: 'Too many tags.' };
  return { ok: true, task: { ...task, tags } };
}

// ---------------------------------------------------------------- fetch
/** One upstream call carrying the user's own token. What the browser is told never includes upstream detail. */
async function callTes(url: string, method: string, access: { token: string }, body?: unknown): Promise<{ status: number; payload: unknown } | { status: number; error: string }> {
  const r = await callUpstream(url, { method, headers: tesHeaders(access, body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined }, { timeoutMs: UPSTREAM_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES });
  switch (r.kind) {
    case 'ok': return { status: r.status, payload: r.payload };
    case 'rejected': { const e = tesPublicError(r.status, r.payload); return { status: e.status, error: e.body.error }; }
    case 'too-large': return { status: 502, error: 'The jobs service returned too much data.' };
    case 'unreadable': return { status: 502, error: 'The jobs service returned an unreadable response.' };
    case 'timeout': return { status: 504, error: 'The jobs service took too long to respond.' };
    case 'unreachable': return { status: 502, error: 'The jobs service could not be reached.' };
  }
}

// ---------------------------------------------------------------- the Runner
const tesView = (d: Detail): 'FULL' | 'BASIC' => (d === 'full' ? 'FULL' : 'BASIC');
/** TES query string for a RunQuery. Same whitelist order as before; `detail` becomes TES `view`. A neutral state that maps to one TES state is filtered upstream. */
export function tesQuery(q: RunQuery, defaultDetail: Detail): string {
  const params = new URLSearchParams();
  params.set('view', tesView(q.detail ?? defaultDetail));
  const states = q.state ? tesStatesFor(q.state) : [];
  if (states.length === 1) params.set('state', states[0]);
  if (q.page_size !== undefined) params.set('page_size', String(q.page_size));
  if (q.page_token !== undefined) params.set('page_token', q.page_token);
  if (q.name_prefix !== undefined) params.set('name_prefix', q.name_prefix);
  for (const k of q.tag_key ?? []) params.append('tag_key', k);
  for (const v of q.tag_value ?? []) params.append('tag_value', v);
  return `?${params.toString()}`;
}

async function call(target: TesTarget, qs: string, method: string, ctx: RunnerContext, body?: unknown): Promise<unknown> {
  const url = upstreamUrl(target, qs);
  if (!url) throw new RunnerError(503, 'The jobs service is not configured.');
  const out = await callTes(url, method, ctx, body);
  if ('error' in out) throw new RunnerError(out.status, out.error);
  return out.payload;
}
const unreadable = () => new RunnerError(502, 'The jobs service returned an unreadable response.');

export const tesRunner: Runner = {
  id: 'tes',
  async submit(spec: LaunchSpec, ctx) {
    if (spec.dag) throw new RunnerError(400, 'This job needs a workflow engine; the active jobs runner (TES) runs container jobs only.');
    const p = prepareTask(toTesTask(spec), ctx.user, { declaredSecrets: new Set(spec.secrets) });
    if (!p.ok) throw new RunnerError(p.status, p.error, p.details ?? []);
    const payload = await call({ kind: 'create' }, '', 'POST', ctx, p.task);
    const id = (payload as { id?: unknown } | null)?.id;
    if (!isRunId(id)) throw unreadable();
    return { id, warnings: spec.warnings };
  },
  async list(q, ctx): Promise<RunList> {
    const l = normalizeTaskList(await call({ kind: 'list' }, tesQuery(q, 'summary'), 'GET', ctx));
    if (!l) throw unreadable();
    const runs = l.tasks.map(fromTesTask);
    // a neutral state that covers several TES states (running, failed) cannot be one upstream filter: filter this page here
    const multi = q.state !== undefined && tesStatesFor(q.state).length !== 1;
    return { runs: multi ? runs.filter((r) => r.state === q.state) : runs, next_page_token: l.next_page_token };
  },
  async get(id, ctx, opts): Promise<Run> {
    if (!isRunId(id)) throw new RunnerError(400, 'Invalid run id.');
    const t = normalizeTask(await call({ kind: 'get', id }, `?view=${tesView(opts?.detail ?? 'full')}`, 'GET', ctx));
    if (!t) throw unreadable();
    return fromTesTask(t);
  },
  async cancel(id, ctx) {
    if (!isRunId(id)) throw new RunnerError(400, 'Invalid run id.');
    await call({ kind: 'cancel', id }, '', 'POST', ctx);
  },
  async info(ctx) {
    const payload = await call({ kind: 'service-info' }, '', 'GET', ctx);
    if (!payload || typeof payload !== 'object' || JSON.stringify(payload).length > 64 * 1024) throw unreadable();
    return normalizeServiceInfo(payload);
  },
  async storageSetup(ctx) {
    const s = normalizeStorageSetup(await call({ kind: 'storage-setup' }, '', 'GET', ctx));
    if (!s) throw unreadable();
    return s;
  },
};

import { hasControlChars } from '@/lib/safe-text';
import { DETAILS, RUN_STATES, isRunId } from './model';
import type { Level } from './portal';
import type { RunQuery } from './runner';

type JobsRoute =
  | { kind: 'service-info' }
  | { kind: 'storage-setup' }
  | { kind: 'list' }
  | { kind: 'get'; id: string }
  | { kind: 'cancel'; id: string }
  | { kind: 'rename'; id: string }
  | { kind: 'groups' }
  | { kind: 'results'; id: string }
  | { kind: 'result-file'; id: string; name: string };

const SEGMENT = /^[A-Za-z0-9._:-]{1,160}$/;
const RESULT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/**
 * Exact allowlist for the catch-all /api/jobs/[...route]. There is deliberately NO client route that creates a raw run
 * (catalog jobs go through POST /api/jobs/submit). Anything else is null (404 before auth): `runs` POST, `storage/user-bucket`, ...
 */
export function matchJobsRoute(method: string, raw: string | string[] | undefined): JobsRoute | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) return null;
  if (!raw.every((s) => typeof s === 'string' && SEGMENT.test(s))) return null;
  const [a, b] = raw;
  if (raw.length === 1) {
    if (a === 'service-info' && method === 'GET') return { kind: 'service-info' };
    if (a === 'storage-setup' && method === 'GET') return { kind: 'storage-setup' };
    if (a === 'groups' && method === 'GET') return { kind: 'groups' };
    if (a === 'runs' && method === 'GET') return { kind: 'list' };
    return null;
  }
  if (a !== 'runs') return null;
  // runs/<id>/results and runs/<id>/results/<file>: what a finished run wrote (read only)
  if (raw.length >= 3) {
    if (method !== 'GET' || !isRunId(b) || raw[2] !== 'results') return null;
    if (raw.length === 3) return { kind: 'results', id: b };
    return RESULT_NAME.test(raw[3]) ? { kind: 'result-file', id: b, name: raw[3] } : null;
  }
  if (method === 'GET' && isRunId(b)) return { kind: 'get', id: b };
  if (method === 'POST' && b.endsWith(':cancel')) {
    const id = b.slice(0, -':cancel'.length);
    if (isRunId(id)) return { kind: 'cancel', id };
  }
  if (method === 'POST' && b.endsWith(':rename')) {
    const id = b.slice(0, -':rename'.length);
    if (isRunId(id)) return { kind: 'rename', id };
  }
  return null;
}
export const routeLevel = (r: JobsRoute): Level => (r.kind === 'cancel' || r.kind === 'rename' ? 'submit' : 'read');

type Q = Record<string, string | string[] | undefined>;
const PRINT = /^[\x21-\x7e]+$/;

/** Whitelist and validate query params into a RunQuery, or an error. */
export function parseRunQuery(route: JobsRoute, query: Q): { ok: true; query: RunQuery } | { ok: false; error: string } {
  const { route: _r, ...rest } = query;
  void _r;
  const allowed = route.kind === 'list' ? ['name_prefix', 'state', 'tag_key', 'tag_value', 'page_size', 'page_token', 'detail', 'scope'] : route.kind === 'get' ? ['detail', 'step'] : route.kind === 'result-file' ? ['download'] : [];
  for (const k of Object.keys(rest)) if (!allowed.includes(k)) return { ok: false, error: `Unknown query parameter "${k.slice(0, 30)}".` };
  const one = (k: string): string | null | undefined => {
    const v = rest[k];
    if (v === undefined) return undefined;
    return typeof v === 'string' ? v : null;
  };
  const q: RunQuery = {};
  const detail = one('detail');
  if (detail !== undefined) { if (detail === null || !(DETAILS as readonly string[]).includes(detail)) return { ok: false, error: 'Invalid detail.' }; q.detail = detail as RunQuery['detail']; }
  const state = one('state');
  if (state !== undefined) { if (state === null || !(RUN_STATES as readonly string[]).includes(state)) return { ok: false, error: 'Invalid state.' }; q.state = state as RunQuery['state']; }
  const sc = one('scope');
  if (sc !== undefined) { if (sc === null || !['mine', 'shared', 'all'].includes(sc)) return { ok: false, error: 'Invalid scope.' }; q.scope = sc as RunQuery['scope']; }
  const ps = one('page_size');
  if (ps !== undefined) { if (ps === null || !/^\d{1,4}$/.test(ps) || Number(ps) < 1 || Number(ps) > 512) return { ok: false, error: 'page_size must be 1..512.' }; q.page_size = Number(ps); }
  const pt = one('page_token');
  if (pt !== undefined) { if (pt === null || pt.length > 512 || !PRINT.test(pt)) return { ok: false, error: 'Invalid page_token.' }; q.page_token = pt; }
  const np = one('name_prefix');
  if (np !== undefined) {
    if (np === null || np.length > 128 || hasControlChars(np)) return { ok: false, error: 'Invalid name_prefix.' };
    q.name_prefix = np;
  }
  if (route.kind === 'get' && rest.step !== undefined) {
    const list = Array.isArray(rest.step) ? rest.step : [rest.step];
    if (list.length > 8 || list.some((x) => typeof x !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(x))) return { ok: false, error: 'Invalid step.' };
    q.steps = list as string[];
  }
  for (const k of ['tag_key', 'tag_value'] as const) {
    const v = rest[k];
    if (v === undefined) continue;
    const list = Array.isArray(v) ? v : [v];
    if (list.length > 10 || list.some((x) => typeof x !== 'string' || x.length > 256 || hasControlChars(x))) return { ok: false, error: `Invalid ${k}.` };
    q[k] = list;
  }
  return { ok: true, query: q };
}

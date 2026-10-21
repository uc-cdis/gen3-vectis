/**
 * The durable run history, kept by the catalog service in the bucket (the portal holds no AWS access). The workflow engine keeps a run only as
 * long as its own volume lives, and who may see a run must not hang on a key that lives in the cluster; so a small record per run is kept here,
 * owned by a person or a group, and the Runs list is read from it.
 *
 * A scope is who owns a record: "u-<32 hex>" for a person (the first 128 bits of the SHA-256 of their verified username, so no secret that could
 * be lost or rotated), "g-<group>" for a group. This client never decides who may use a scope: the handlers do, with Arborist, before they ask.
 */
import { createHash } from 'node:crypto';
import { clusterBase, podToken } from './cluster';
import { isProduction } from './portal';
import { normalizeRun, type Run } from './model';

export const GROUP_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const personalScope = (user: string): string => `u-${createHash('sha256').update(user.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
export const groupScope = (group: string): string => `g-${group}`;
export const isGroupScope = (s: string): boolean => s.startsWith('g-');

export interface HistoryRecord { scope: string; run: Run; saved_at: string }
export interface HistoryPage { records: HistoryRecord[]; next: string | null }
export interface HistoryClient {
  put(scope: string, run: Run): Promise<void>;
  list(scopes: string[], after: string | undefined, limit: number): Promise<HistoryPage>;
  get(id: string): Promise<HistoryRecord | null>;
}

const TIMEOUT_MS = 10_000;
const MAX_BODY = 4 * 1024 * 1024;
type Env = Record<string, string | undefined>;

/** The history client, or null when no catalog service is configured or its address is not acceptable. */
export function historyClientFromEnv(env: Env = process.env, fetchImpl: typeof fetch = fetch): HistoryClient | null {
  const raw = env.JOBS_CATALOG_URL?.trim();
  if (!raw) return null;
  const base = clusterBase(raw, env, isProduction(env));
  if (!base) return null;

  async function call(method: 'GET' | 'POST', path: string, query?: URLSearchParams, body?: unknown): Promise<unknown | null> {
    const token = podToken(env);
    if (!token) throw new Error('no pod token');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetchImpl(`${base}${path}${query ? `?${query.toString()}` : ''}`, {
        method, signal: ctrl.signal, redirect: 'error',
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`history service ${r.status}`); // the status only, never the body
      const text = Buffer.from(await r.arrayBuffer());
      if (text.length > MAX_BODY) throw new Error('too large');
      return JSON.parse(text.toString('utf8'));
    } finally { clearTimeout(timer); }
  }
  const asRecord = (x: unknown): HistoryRecord | null => {
    if (!x || typeof x !== 'object') return null;
    const o = x as { scope?: unknown; run?: unknown; saved_at?: unknown };
    const run = normalizeRun(o.run);
    if (!run || typeof o.scope !== 'string' || !/^(u-[0-9a-f]{32}|g-[a-z][a-z0-9-]{0,31})$/.test(o.scope)) return null;
    return { scope: o.scope, run, saved_at: typeof o.saved_at === 'string' ? o.saved_at : '' };
  };

  return {
    async put(scope, run) {
      await call('POST', '/runs/put', undefined, { scope, run });
    },
    async list(scopes, after, limit) {
      const q = new URLSearchParams();
      for (const s of scopes) q.append('scope', s);
      if (after) q.set('after', after);
      q.set('limit', String(limit));
      const out = (await call('GET', '/runs/list', q)) as { runs?: unknown; next?: unknown } | null;
      if (!out || !Array.isArray(out.runs)) throw new Error('bad listing');
      return { records: out.runs.map(asRecord).filter((r): r is HistoryRecord => r !== null), next: typeof out.next === 'string' && out.next ? out.next : null };
    },
    async get(id) {
      return asRecord(await call('GET', '/runs/get', new URLSearchParams({ id })));
    },
  };
}

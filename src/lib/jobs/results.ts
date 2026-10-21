/**
 * Files a job run wrote, read from the catalog service (which holds the AWS access; the portal holds none). The service is reached the
 * same way the catalog is: its cluster-local address, with this pod's own service-account token, sent nowhere else.
 */
import { clusterBase, podToken } from './cluster';
import { isProduction } from './portal';

export interface ResultFile { name: string; size: number }
export interface ResultsClient {
  list(run: string): Promise<ResultFile[]>;
  file(run: string, name: string): Promise<Buffer>;
}
export class ResultNotFound extends Error {}

export const RESULT_RUN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const RESULT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const MAX_RESULT_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

type Env = Record<string, string | undefined>;

/** The results client, or null when no catalog service is configured or its address is not acceptable. */
export function resultsClientFromEnv(env: Env = process.env, fetchImpl: typeof fetch = fetch): ResultsClient | null {
  const raw = env.JOBS_CATALOG_URL?.trim();
  if (!raw) return null;
  const base = clusterBase(raw, env, isProduction(env));
  if (!base) return null;

  async function call(path: string, query: Record<string, string>, max: number): Promise<Buffer> {
    const token = podToken(env);
    if (!token) throw new Error('no pod token');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetchImpl(`${base}${path}?${new URLSearchParams(query).toString()}`, {
        headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal, redirect: 'error',
      });
      if (r.status === 404) throw new ResultNotFound();
      if (!r.ok) throw new Error(`results service ${r.status}`); // the status only, never the body
      const declared = Number(r.headers.get('content-length') ?? '0');
      if (declared > max) throw new Error('too large');
      const body = Buffer.from(await r.arrayBuffer());
      if (body.length > max) throw new Error('too large');
      return body;
    } finally { clearTimeout(timer); }
  }

  return {
    async list(run) {
      if (!RESULT_RUN.test(run)) throw new ResultNotFound();
      const parsed = JSON.parse((await call('/results/list', { run }, 256 * 1024)).toString('utf8')) as { files?: unknown };
      if (!Array.isArray(parsed.files)) throw new Error('bad listing');
      return parsed.files
        .filter((f): f is { name: string; size: number } => !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string' && RESULT_NAME.test((f as { name: string }).name))
        .map((f) => ({ name: f.name, size: typeof f.size === 'number' && f.size >= 0 ? f.size : 0 }))
        .slice(0, 100);
    },
    async file(run, name) {
      if (!RESULT_RUN.test(run) || !RESULT_NAME.test(name)) throw new ResultNotFound();
      return call('/results/file', { run, name }, MAX_RESULT_BYTES);
    },
  };
}

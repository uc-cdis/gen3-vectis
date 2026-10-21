import { readCapped } from '@/lib/upstream';
import { DEF_PATH, FILE, MAX_FILES, MAX_FILE_BYTES, SHA } from './github';
import type { CatalogListing, CatalogSource } from './source';

const TIMEOUT_MS = 10_000;

/**
 * The catalog service (cmd/jobs-catalog in vectis-jobs-services): it reads the catalog a GitHub Action published to S3 and serves it to
 * this server. The portal holds no GitHub token and no AWS access; it only presents its own pod identity (a service-account token). The
 * token is placed only in requests to the service's cluster-local address (see ../cluster.ts).
 */
export function serviceSource(cfg: { base: string; repo: string }, token: () => string | null, fetchImpl: typeof fetch = fetch): CatalogSource {
  async function call(path: string, query?: Record<string, string>): Promise<Response> {
    const tok = token();
    if (!tok) throw new Error('no pod token');
    const url = `${cfg.base}${path}${query ? `?${new URLSearchParams(query).toString()}` : ''}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetchImpl(url, { headers: { accept: 'application/json, text/plain', authorization: `Bearer ${tok}` }, signal: ctrl.signal, redirect: 'error' });
      if (!r.ok) throw new Error(`catalog service ${r.status}`); // status only; never the body or headers
      return r;
    } finally { clearTimeout(t); }
  }
  async function text(r: Response, max: number): Promise<string> {
    const s = await readCapped(r, max);
    if (s === null) throw new Error('too large');
    return s;
  }
  return {
    kind: 'service', repo: cfg.repo, ref: 'published',
    async list(): Promise<CatalogListing> {
      const body = JSON.parse(await text(await call('/catalog/list'), 1024 * 1024)) as { version?: unknown; files?: unknown; truncated?: unknown };
      if (typeof body.version !== 'string' || !SHA.test(body.version) || !Array.isArray(body.files)) throw new Error('bad listing');
      const all = body.files
        .filter((e): e is { name: string; size: number } => !!e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string' && FILE.test((e as { name: string }).name))
        .map((e) => ({ name: e.name, size: typeof e.size === 'number' ? e.size : Infinity }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { version: body.version, files: all.slice(0, MAX_FILES), truncated: body.truncated === true || all.length > MAX_FILES };
    },
    async read(version, name): Promise<string> {
      if (!SHA.test(version) || !FILE.test(name)) throw new Error('bad request');
      return text(await call('/catalog/file', { version, path: name }), MAX_FILE_BYTES);
    },
    async readDefinition(version, relPath): Promise<string> {
      if (!SHA.test(version) || !DEF_PATH.test(relPath) || relPath.split('/').some((s) => s === '.' || s === '..')) throw new Error('bad request');
      return text(await call('/catalog/file', { version, path: relPath }), MAX_FILE_BYTES);
    },
  };
}

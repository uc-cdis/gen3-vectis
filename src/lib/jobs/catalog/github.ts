import { readCapped } from '@/lib/upstream';
import type { CatalogListing, CatalogSource } from './source';

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;
export const SHA = /^[0-9a-f]{40}$/;
export const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\.ya?ml$/;
export const DEF_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}(\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}){0,3}\.ya?ml$/;
const API = 'https://api.github.com';

/** GitHub REST implementation. The token is only ever placed in the Authorization header of requests to api.github.com. */
export function githubSource(cfg: { repo: string; path: string; ref: string }, token: string | undefined, fetchImpl: typeof fetch = fetch): CatalogSource {
  const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');
  async function call(url: string, accept: string): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetchImpl(url, {
        headers: { accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'vectis-portal-catalog', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: ctrl.signal, redirect: 'error',
      });
      if (!r.ok) throw new Error(`github ${r.status}`); // status only; never the body or headers
      return r;
    } finally { clearTimeout(t); }
  }
  async function text(r: Response, max: number): Promise<string> {
    const s = await readCapped(r, max);
    if (s === null) throw new Error('too large');
    return s;
  }
  return {
    kind: 'github', repo: cfg.repo, ref: cfg.ref,
    async list(): Promise<CatalogListing> {
      const c = await call(`${API}/repos/${cfg.repo}/commits/${enc(cfg.ref)}`, 'application/vnd.github+json');
      const sha = (JSON.parse(await text(c, 5 * 1024 * 1024)) as { sha?: unknown }).sha;
      if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('bad sha');
      const d = await call(`${API}/repos/${cfg.repo}/contents/${enc(cfg.path)}?ref=${sha}`, 'application/vnd.github+json');
      const body = JSON.parse(await text(d, 5 * 1024 * 1024)) as unknown;
      if (!Array.isArray(body)) throw new Error('not a directory');
      const all = body
        .filter((e): e is { name: string; type: string; size: number } => !!e && typeof e === 'object' && (e as { type?: unknown }).type === 'file' && typeof (e as { name?: unknown }).name === 'string' && FILE.test((e as { name: string }).name))
        .map((e) => ({ name: e.name, size: typeof e.size === 'number' ? e.size : Infinity }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { version: sha, files: all.slice(0, MAX_FILES), truncated: all.length > MAX_FILES };
    },
    async read(version, name): Promise<string> {
      if (!SHA.test(version) || !FILE.test(name)) throw new Error('bad request');
      const r = await call(`${API}/repos/${cfg.repo}/contents/${enc(cfg.path)}/${encodeURIComponent(name)}?ref=${version}`, 'application/vnd.github.raw+json');
      return text(r, MAX_FILE_BYTES);
    },
    async readDefinition(version, relPath): Promise<string> {
      if (!SHA.test(version) || !DEF_PATH.test(relPath) || relPath.split('/').some((s) => s === '.' || s === '..')) throw new Error('bad request');
      const r = await call(`${API}/repos/${cfg.repo}/contents/${enc(cfg.path)}/${enc(relPath)}?ref=${version}`, 'application/vnd.github.raw+json');
      return text(r, MAX_FILE_BYTES);
    },
  };
}

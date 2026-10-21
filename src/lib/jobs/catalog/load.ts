import type { CatalogDef } from '../jobdef/types';
import { isDagDef } from '../jobdef/types';
import { isDagEntryData, parseDagEntry, parseJobDef, peekEntry, MAX_JOBDEF_BYTES } from '../jobdef/parse';
import { lintDaguDefinition } from '../dagu/lint';
import { sanitizeLabel, sanitizeUntrusted } from '@/lib/safe-text';
import { clusterBase, podToken } from '../cluster';
import { isProduction } from '../portal';
import { githubSource, MAX_FILES } from './github';
import { serviceSource } from './service';
import { readCatalogConfig, type CatalogSource } from './source';

export interface Catalog {
  configured: boolean;
  repo: string | null;
  ref: string | null;
  sha: string | null;
  fetched_at: string | null;
  /** `native` is the engine's own definition text for a `kind: dag` entry. SERVER-SIDE ONLY: publicCatalog() removes it. */
  jobs: Array<{ def: CatalogDef; file: string; native?: { text: string; dag_name: string } }>;
  errors: Array<{ file: string; errors: string[] }>;
  /** true when the source could not be read and this is the last copy that was (see MAX_STALE_MS) */
  stale?: boolean;
}
const EMPTY_CATALOG: Catalog = { configured: false, repo: null, ref: null, sha: null, fetched_at: null, jobs: [], errors: [] };
export class CatalogError extends Error {}

const CACHE_MS = 60_000;
const FAIL_MS = 15_000; // failures are cached briefly so a broken source does not burn the GitHub rate limit
const cache = new Map<string, { at: number; value: Catalog }>();
const failures = new Map<string, number>();
// The last catalog that loaded, kept past CACHE_MS so a source outage does not remove the Jobs page. It is a real, pinned commit that was
// published earlier; the limit bounds how long a definition withdrawn at the source could still be started.
const MAX_STALE_MS = 6 * 60 * 60_000;
const lastGood = new Map<string, { at: number; value: Catalog }>();
export const clearCatalogCache = () => { cache.clear(); failures.clear(); lastGood.clear(); };

/** Build the active source from env, or null if none is configured. Throws CatalogError on bad/ambiguous config. */
export function activeSource(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): CatalogSource | null {
  // The catalog service (JOBS_CATALOG_URL) wins: the portal then needs no GitHub token. Its label is only for display.
  const serviceUrl = env.JOBS_CATALOG_URL?.trim();
  if (serviceUrl) {
    const base = clusterBase(serviceUrl, env, isProduction(env));
    if (!base || !podToken(env)) throw new CatalogError('Catalog is misconfigured.');
    const label = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(env.TES_CATALOG_REPO?.trim() ?? '') ? (env.TES_CATALOG_REPO as string).trim() : 'catalog';
    return serviceSource({ base, repo: label }, () => podToken(env), fetchImpl);
  }
  const cfg = readCatalogConfig(env);
  if (cfg.kind === 'none') return null;
  if (cfg.kind === 'error') throw new CatalogError(cfg.message);
  return githubSource(cfg, env.TES_CATALOG_GITHUB_TOKEN || undefined, fetchImpl);
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = Array.from<R>({ length: items.length });
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export async function loadCatalog(source: CatalogSource | null, env: Record<string, string | undefined> = process.env): Promise<Catalog> {
  if (!source) return EMPTY_CATALOG;
  const key = `${source.kind}:${source.repo}@${source.ref}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const fallback = (): Catalog => {
    const old = lastGood.get(key);
    if (old && Date.now() - old.at < MAX_STALE_MS) return { ...old.value, stale: true };
    throw new CatalogError('The catalog source could not be read.');
  };
  const failedAt = failures.get(key);
  if (failedAt !== undefined && Date.now() - failedAt < FAIL_MS) return fallback();
  let listing;
  try { listing = await source.list(); } catch { failures.set(key, Date.now()); return fallback(); }
  failures.delete(key);
  const jobs: Catalog['jobs'] = [];
  const errors: Catalog['errors'] = [];
  const ids = new Set<string>();
  if (listing.truncated) errors.push({ file: '(directory)', errors: [`only the first ${MAX_FILES} files are read`] });
  type Parsed = { ok: true; def: CatalogDef; native?: { text: string; dag_name: string } } | { ok: false; errors: string[] };
  /** One catalog file: a container job (parseJobDef) or a `kind: dag` entry plus its native file from the SAME commit, linted. */
  const load = async (text: string): Promise<Parsed> => {
    const peek = peekEntry(text);
    if (!peek.ok) return peek;
    if (!isDagEntryData(peek.data)) return parseJobDef(text);
    const entry = parseDagEntry(text);
    if (!entry.ok) return entry;
    let native: string;
    try { native = await source.readDefinition(listing.version, entry.def.definition); } catch { return { ok: false, errors: ['the native definition file could not be read from the catalog'] }; }
    const lint = lintDaguDefinition(native, { env, catalogParams: (entry.def.params ?? []).filter((p) => p.type !== 'secret').map((p) => p.name), fallbackName: entry.def.id });
    if (!lint.ok) return { ok: false, errors: lint.errors.map((e) => `${entry.def.definition}: ${e}`) };
    return { ok: true, def: { ...entry.def, graph: lint.info.steps }, native: { text: native, dag_name: lint.info.name ?? entry.def.id } };
  };
  const results = await pool(listing.files, 8, async (f) => {
    if (!(f.size <= MAX_JOBDEF_BYTES)) return { file: f.name, errors: ['file is larger than 64KB'] };
    try { return { file: f.name, parsed: await load(await source.read(listing.version, f.name)) }; } catch { return { file: f.name, errors: ['file could not be read'] }; }
  });
  for (const r of results) {
    const file = sanitizeLabel(r.file, 100);
    if ('errors' in r && r.errors) errors.push({ file, errors: r.errors });
    else if (r.parsed?.ok) {
      if (ids.has(r.parsed.def.id)) errors.push({ file, errors: [`duplicate job id "${r.parsed.def.id}"`] });
      else { ids.add(r.parsed.def.id); jobs.push({ def: sanitizeUntrusted(r.parsed.def), file, ...(r.parsed.native ? { native: r.parsed.native } : {}) }); }
    } else if (r.parsed) errors.push({ file, errors: r.parsed.errors.map((e) => sanitizeLabel(e, 200)) });
  }
  const value: Catalog = { configured: true, repo: source.repo, ref: source.ref, sha: listing.version, fetched_at: new Date().toISOString(), jobs, errors };
  cache.set(key, { at: Date.now(), value });
  lastGood.set(key, { at: Date.now(), value });
  return value;
}

const SENSITIVE_NAME = /secret|token|passw|key|credential|auth|cert/i;
const hide = (env: Record<string, string> | undefined) =>
  env && Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.startsWith('secret://') || v.includes('{{') || (!SENSITIVE_NAME.test(k) && v.length <= 128) ? v : '[hidden]']));

/** What the browser gets: literal env values are hidden unless they are secret:// references, templates or short non-sensitive-looking values. */
export function publicCatalog(c: Catalog): Catalog {
  return {
    ...c,
    jobs: c.jobs.map(({ def, file }) => {
      if (isDagDef(def)) return { file, def }; // the native text and its path are not needed by the browser (it gets the graph)
      return {
        file,
        def: { ...def, ...(def.env ? { env: hide(def.env) } : {}), ...(def.executors_after ? { executors_after: def.executors_after.map((x) => ({ ...x, ...(x.env ? { env: hide(x.env) } : {}) })) } : {}) },
      };
    }),
  };
}

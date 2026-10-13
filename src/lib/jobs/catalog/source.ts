/** A place job definitions can be read from. Implementations must be read-only and must pin a version before listing. */
interface CatalogFile { name: string; size: number }
export interface CatalogListing { version: string; files: CatalogFile[]; truncated: boolean }
export interface CatalogSource {
  kind: 'github';
  /** Label shown to users and recorded in vectis.catalog_repo: owner/name for GitHub. */
  repo: string;
  ref: string;
  /** Resolve the ref to an immutable version (commit SHA) and list the directory AT that version. */
  list(): Promise<CatalogListing>;
  /** Read one file AT the given version. */
  read(version: string, name: string): Promise<string>;
  /** Read a native workflow definition (a yaml file under the catalog directory, e.g. `dags/hello.yaml`) AT the same version. */
  readDefinition(version: string, relPath: string): Promise<string>;
}
type CatalogConfig =
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'github'; repo: string; path: string; ref: string };

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}){0,7}$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/;

/** GitHub is the only source (add others behind CatalogSource). Any malformed value is an error (deny). */
export function readCatalogConfig(env: Record<string, string | undefined> = process.env): CatalogConfig {
  const repo = env.TES_CATALOG_REPO?.trim() || undefined;
  if (!repo) return { kind: 'none' };
  const path = (env.TES_CATALOG_PATH?.trim() || 'jobs').replace(/\/+$/, '');
  const ref = env.TES_CATALOG_REF?.trim() || 'main';
  const [o, n] = repo.split('/');
  const bad = !REPO.test(repo) || o === '.' || o === '..' || n === '.' || n === '..' || !PATH.test(path) || path.split('/').some((s) => s === '..' || s === '.')
    || !REF.test(ref) || ref.includes('..') || ref.includes('//') || ref.endsWith('/') || ref.endsWith('.lock');
  return bad ? { kind: 'error', message: 'Catalog is misconfigured.' } : { kind: 'github', repo, path, ref };
}

/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCatalogConfig } from './source';
import { activeSource, clearCatalogCache, loadCatalog, CatalogError } from './load';

const TOKEN = 'ghp_SUPERSECRETTOKEN0123456789abcdefghij';
const SHA = 'b'.repeat(40);
const GOOD = 'schema_version: 1\nid: good\nname: Good\nimage: alpine\ncommand: [echo, hi]\n';
const BAD = 'schema_version: 1\nid: bad\nname: Bad\nimage: alpine\ncommand: [sh, -c, "{{x}}"]\nprivileged: true\n';
const env = (o: Record<string, string> = {}) => ({ TES_CATALOG_REPO: 'org/jobs', TES_CATALOG_GITHUB_TOKEN: TOKEN, ...o });

function gh(files: Record<string, string>, opts: { failCommit?: boolean } = {}) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname.includes('/commits/')) return opts.failCommit ? new Response(`denied ${TOKEN}`, { status: 404 }) : new Response(JSON.stringify({ sha: SHA }), { status: 200 });
    if (u.pathname.endsWith('/contents/jobs')) {
      if (u.searchParams.get('ref') !== SHA) throw new Error('listed at the wrong ref'); // must list AT the resolved sha
      return new Response(JSON.stringify([...Object.keys(files).map((name) => ({ name, type: 'file', size: files[name].length })), { name: 'sub', type: 'dir', size: 0 }, { name: 'README.md', type: 'file', size: 3 }]), { status: 200 });
    }
    const name = decodeURIComponent(u.pathname.split('/').pop()!);
    if (u.searchParams.get('ref') !== SHA) throw new Error('read at the wrong ref');
    return files[name] !== undefined ? new Response(files[name], { status: 200 }) : new Response('', { status: 404 });
  });
}
beforeEach(() => clearCatalogCache());
afterEach(() => vi.unstubAllGlobals());

describe('readCatalogConfig', () => {
  it('is unconfigured without a repo, with defaults when set', () => {
    expect(readCatalogConfig({})).toEqual({ kind: 'none' });
    expect(readCatalogConfig({ TES_CATALOG_REPO: 'org/jobs' })).toEqual({ kind: 'github', repo: 'org/jobs', path: 'jobs', ref: 'main' });
  });
  it('rejects path traversal and malformed values', () => {
    for (const p of ['../secrets', 'jobs/../../x', '/etc', 'jobs//x', 'a/./b', '..', 'jobs?x=1', 'jo\nbs', '.hidden/x']) expect(readCatalogConfig({ TES_CATALOG_REPO: 'org/jobs', TES_CATALOG_PATH: p }).kind, p).toBe('error');
    for (const r of ['org', 'org/../x', '../jobs', 'org/jobs/extra', 'org/jo bs', './x']) expect(readCatalogConfig({ TES_CATALOG_REPO: r }).kind, r).toBe('error');
    for (const ref of ['a..b', '-x', 'a//b', 'x/', 'a b']) expect(readCatalogConfig({ TES_CATALOG_REPO: 'o/j', TES_CATALOG_REF: ref }).kind, ref).toBe('error');
  });
});

describe('loadCatalog', () => {
  it('returns configured:false and never fetches when unset', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(activeSource({})).toBeNull();
    expect(await loadCatalog(null)).toMatchObject({ configured: false, jobs: [], errors: [] });
    expect(f).not.toHaveBeenCalled();
  });
  it('throws without fetching on a traversal path', () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(() => activeSource(env({ TES_CATALOG_PATH: '../..' }), f as never)).toThrow(CatalogError);
    expect(f).not.toHaveBeenCalled();
  });
  it('a bad file never hides good ones; only yaml files are read', async () => {
    const f = gh({ 'good.yaml': GOOD, 'bad.yml': BAD, 'big.yaml': 'x'.repeat(70000) });
    const c = await loadCatalog(activeSource(env(), f as never));
    expect(c).toMatchObject({ configured: true, repo: 'org/jobs', ref: 'main', sha: SHA });
    expect(c.jobs.map((j) => j.def.id)).toEqual(['good']);
    expect(c.errors.map((e) => e.file).sort()).toEqual(['bad.yml', 'big.yaml']);
    expect(f.mock.calls.map((x) => String(x[0])).some((u) => u.includes('README'))).toBe(false);
  });
  it('flags duplicate ids and caches for 60s', async () => {
    const f = gh({ 'a.yaml': GOOD, 'b.yaml': GOOD });
    const src = activeSource(env(), f as never);
    const c = await loadCatalog(src);
    expect(c.jobs).toHaveLength(1); expect(c.errors[0].errors[0]).toMatch(/duplicate/);
    const calls = f.mock.calls.length;
    await loadCatalog(src);
    expect(f.mock.calls.length).toBe(calls);
    vi.useFakeTimers({ now: Date.now() + 61_000 });
    try { await loadCatalog(src); } finally { vi.useRealTimers(); }
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });
  it('the GitHub token only goes to api.github.com and never appears in any result or error', async () => {
    const f = gh({ 'good.yaml': GOOD });
    const c = await loadCatalog(activeSource(env(), f as never));
    expect(JSON.stringify(c)).not.toContain('SUPERSECRET');
    for (const [url, init] of f.mock.calls as Array<[string, RequestInit]>) {
      expect(new URL(url).host).toBe('api.github.com');
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
      expect(init.redirect).toBe('error');
    }
    clearCatalogCache();
    const err = await loadCatalog(activeSource(env(), gh({}, { failCommit: true }) as never)).catch((e) => e as Error);
    expect(err).toBeInstanceOf(CatalogError);
    expect(String((err as Error).message)).not.toContain('SUPERSECRET');
  });
  it('omits the Authorization header when no token is configured', async () => {
    const f = gh({ 'good.yaml': GOOD });
    await loadCatalog(activeSource({ TES_CATALOG_REPO: 'org/jobs' }, f as never));
    for (const [, init] of f.mock.calls as Array<[string, RequestInit]>) expect(Object.keys(init.headers as object)).not.toContain('authorization');
  });
});

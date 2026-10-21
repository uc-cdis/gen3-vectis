import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { activeSource, CatalogError } from './load';
import { serviceSource } from './service';

const SHA = 'a'.repeat(40);
const BASE = 'http://jobs-catalog.default.svc.cluster.local:8080';
const tokenFile = (() => { const f = join(mkdtempSync(join(tmpdir(), 'pod-')), 'token'); writeFileSync(f, 'pod.token.value\n'); return f; })();
const ENV = { NODE_ENV: 'production', DAGU_ALLOW_CLUSTER_HTTP: 'yes', JOBS_CATALOG_URL: BASE, DAGU_SA_TOKEN_FILE: tokenFile };

const fakeFetch = (routes: Record<string, { status?: number; body: string }>) => {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init.headers).get('authorization') });
    const hit = routes[url];
    return new Response(hit?.body ?? 'nope', { status: hit ? hit.status ?? 200 : 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
};

describe('the catalog service source', () => {
  it('lists the published version and its yaml files, and sends only the pod token', async () => {
    const { f, calls } = fakeFetch({ [`${BASE}/catalog/list`]: { body: JSON.stringify({ version: SHA, files: [{ name: 'b.yaml', size: 3 }, { name: 'a.yml', size: 2 }, { name: 'notes.md', size: 1 }, { name: '../x.yaml', size: 1 }], truncated: false }) } });
    const s = serviceSource({ base: BASE, repo: 'org/jobs' }, () => 'pod.token.value', f);
    expect(await s.list()).toEqual({ version: SHA, files: [{ name: 'a.yml', size: 2 }, { name: 'b.yaml', size: 3 }], truncated: false });
    expect(calls[0].auth).toBe('Bearer pod.token.value');
    expect(s).toMatchObject({ kind: 'service', repo: 'org/jobs' });
  });
  it('reads a file and a definition at a pinned version, through the same endpoint', async () => {
    const { f, calls } = fakeFetch({
      [`${BASE}/catalog/file?version=${SHA}&path=hello.yaml`]: { body: 'id: hello\n' },
      [`${BASE}/catalog/file?version=${SHA}&path=dags%2Fhello.yaml`]: { body: 'name: hello\n' },
    });
    const s = serviceSource({ base: BASE, repo: 'org/jobs' }, () => 'tok', f);
    expect(await s.read(SHA, 'hello.yaml')).toBe('id: hello\n');
    expect(await s.readDefinition(SHA, 'dags/hello.yaml')).toBe('name: hello\n');
    expect(calls).toHaveLength(2);
  });
  it('refuses a bad version or path before any request is made, and a missing token', async () => {
    const { f, calls } = fakeFetch({});
    const s = serviceSource({ base: BASE, repo: 'org/jobs' }, () => 'tok', f);
    for (const bad of [['latest', 'a.yaml'], [SHA, '../a.yaml'], [SHA, 'a.md'], [SHA, '.hidden.yaml']] as const) await expect(s.read(bad[0], bad[1])).rejects.toThrow();
    await expect(s.readDefinition(SHA, 'dags/../../x.yaml')).rejects.toThrow();
    expect(calls).toHaveLength(0);
    await expect(serviceSource({ base: BASE, repo: 'x/y' }, () => null, f).list()).rejects.toThrow('no pod token');
  });
  it('throws on a service error and on an unusable listing, without echoing the body', async () => {
    const { f } = fakeFetch({ [`${BASE}/catalog/list`]: { status: 502, body: 'secret internals' } });
    await expect(serviceSource({ base: BASE, repo: 'x/y' }, () => 'tok', f).list()).rejects.toThrow(/502/);
    const bad = fakeFetch({ [`${BASE}/catalog/list`]: { body: JSON.stringify({ version: 'not-a-sha', files: [] }) } });
    await expect(serviceSource({ base: BASE, repo: 'x/y' }, () => 'tok', bad.f).list()).rejects.toThrow('bad listing');
  });
});

describe('choosing the catalog source', () => {
  it('uses the service when JOBS_CATALOG_URL is set, even if a GitHub repo is also configured, and never builds a GitHub source', () => {
    const s = activeSource({ ...ENV, TES_CATALOG_REPO: 'uc-cdis/iso-data-platform', TES_CATALOG_GITHUB_TOKEN: 'ghp_x' });
    expect(s).toMatchObject({ kind: 'service', repo: 'uc-cdis/iso-data-platform', ref: 'published' });
  });
  it('is misconfigured, not silently empty, for a URL that is not cluster-local, over https, or without a pod token', () => {
    for (const env of [
      { ...ENV, JOBS_CATALOG_URL: 'https://catalog.example.org' }, { ...ENV, JOBS_CATALOG_URL: 'http://evil.example.org:8080' },
      { ...ENV, JOBS_CATALOG_URL: 'http://10.0.0.5:8080' }, { ...ENV, DAGU_ALLOW_CLUSTER_HTTP: undefined }, { ...ENV, DAGU_SA_TOKEN_FILE: join(tmpdir(), 'no-such-token') },
    ]) expect(() => activeSource(env)).toThrow(CatalogError);
  });
  it('without JOBS_CATALOG_URL it is GitHub or none, as before', () => {
    expect(activeSource({ NODE_ENV: 'production' })).toBeNull();
    expect(activeSource({ NODE_ENV: 'production', TES_CATALOG_REPO: 'org/jobs' })).toMatchObject({ kind: 'github' });
  });
});

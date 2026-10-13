/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAG_FIXTURE_DEFS } from '../api/fixtureApi';
import { clearCatalogCache, loadCatalog, publicCatalog } from '../catalog/load';
import type { CatalogSource } from '../catalog/source';
import { githubSource } from '../catalog/github';
import { isDagDef } from '../jobdef/types';
import { tesRunner } from '../tes/tesRunner';
import { RunnerError } from '../runner';
import { DAG_FANOUT, DAG_HELLO, DAG_SOC, ENTRY_FANOUT, ENTRY_HELLO, ENTRY_SOC } from '../testing/definitions';

const SHA = 'c'.repeat(40);
const DEV = { NODE_ENV: 'test', DAGU_ALLOWED_EXECUTORS: 'command,http,jq' };
const entryFiles: Record<string, string> = { 'dag-fanout.yaml': ENTRY_FANOUT, 'dag-hello.yaml': ENTRY_HELLO, 'dag-soc-enrich.yaml': ENTRY_SOC };
const dags: Record<string, string> = { 'dags/fanout.yaml': DAG_FANOUT, 'dags/hello.yaml': DAG_HELLO, 'dags/soc-enrich-indicator.yaml': DAG_SOC };

function source(files: Record<string, string>, native: Record<string, string>): CatalogSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    kind: 'github', repo: 'org/jobs', ref: 'main', reads,
    list: async () => ({ version: SHA, files: Object.keys(files).map((name) => ({ name, size: files[name].length })), truncated: false }),
    read: async (_v, name) => files[name],
    readDefinition: async (v, p) => { reads.push(`${v}:${p}`); if (native[p] === undefined) throw new Error('404'); return native[p]; },
  };
}
const entry = (extra = '', def = 'dags/a.yaml') => `schema_version: 1\nkind: dag\nengine: dagu\nid: a\nname: A\ndefinition: ${def}\n${extra}`;
const GOOD = 'name: a\nsteps:\n  - id: s\n    run: echo hi\n';

beforeEach(() => clearCatalogCache());
afterEach(() => vi.unstubAllGlobals());

describe('sample workflow definitions load as a catalog', () => {
  it('every sample workflow entry passes the loader', async () => {
    const c = await loadCatalog(source(entryFiles, dags), DEV);
    expect(c.errors).toEqual([]);
    expect(c.jobs.map((j) => j.def.id).sort()).toEqual(['dag-fanout', 'dag-hello', 'dag-soc-enrich']);
    for (const j of c.jobs) { expect(isDagDef(j.def)).toBe(true); expect(j.native?.text.length).toBeGreaterThan(10); }
  });
  it('the development fixtures show exactly the graphs the loader derives from the definitions', async () => {
    const c = await loadCatalog(source(entryFiles, dags), DEV);
    for (const fx of DAG_FIXTURE_DEFS) {
      const real = c.jobs.find((j) => j.def.id === fx.id)?.def;
      expect(real, fx.id).toBeDefined();
      expect(JSON.parse(JSON.stringify(real)), fx.id).toEqual(JSON.parse(JSON.stringify(fx))); // the whole entry, including description, tags, owner, params and graph
    }
  });
  it('with the DEFAULT executors only the SOC playbook (http + jq) loads; the others are reported, not served', async () => {
    const c = await loadCatalog(source(entryFiles, dags), { NODE_ENV: 'test' });
    expect(c.jobs.map((j) => j.def.id)).toEqual(['dag-soc-enrich']);
    expect(c.errors.map((e) => e.file).sort()).toEqual(['dag-fanout.yaml', 'dag-hello.yaml']);
    expect(c.errors[0].errors.join(' ')).toMatch(/"command" executor is not enabled/);
  });
});

describe('loading a workflow entry', () => {
  it('reads the native file from the SAME commit (never a ref), and keeps the text server-side', async () => {
    const s = source({ 'a.yaml': entry() }, { 'dags/a.yaml': GOOD });
    const c = await loadCatalog(s, DEV);
    expect(s.reads).toEqual([`${SHA}:dags/a.yaml`]);
    expect(c.jobs[0].native).toEqual({ text: GOOD, dag_name: 'a' });
    const pub = JSON.stringify(publicCatalog(c));
    expect(pub).not.toContain('echo hi');
    expect(pub).not.toContain('native');
    expect(publicCatalog(c).jobs[0].def).toMatchObject({ kind: 'dag', engine: 'dagu', graph: [{ name: 's', depends_on: [], executor: 'command' }] });
  });
  it('an entry whose native file is missing, unlinted, or declares fewer params is an error, and never hides good entries', async () => {
    const s = source({
      'a.yaml': entry(), 'missing.yaml': entry('', 'dags/nope.yaml').replace('id: a', 'id: m'), 'bad.yaml': entry('', 'dags/bad.yaml').replace('id: a', 'id: b'),
      'p.yaml': `${entry('params:\n  - {name: undeclared, label: U, type: string}\n')}`.replace('id: a', 'id: p'),
    }, { 'dags/a.yaml': GOOD, 'dags/bad.yaml': 'steps:\n  - id: s\n    run: echo\n    stdout: /tmp/x\n' });
    const c = await loadCatalog(s, DEV);
    expect(c.jobs.map((j) => j.def.id)).toEqual(['a']);
    expect(Object.fromEntries(c.errors.map((e) => [e.file, e.errors.join(' ')]))).toMatchObject({
      'missing.yaml': expect.stringContaining('could not be read'), 'bad.yaml': expect.stringContaining('not allowed in a portal-managed'), 'p.yaml': expect.stringContaining('"undeclared" is not declared'),
    });
  });
  it('a `kind` that is not dag is refused (fail closed), a container job without kind still works', async () => {
    const s = source({ 'k.yaml': 'schema_version: 1\nkind: container\nid: k\nname: K\nimage: a\ncommand: [x]\n', 'c.yaml': 'schema_version: 1\nid: c\nname: C\nimage: alpine\ncommand: [echo, hi]\n' }, {});
    const c = await loadCatalog(s, DEV);
    expect(c.jobs.map((j) => j.def.id)).toEqual(['c']);
    expect(c.errors.map((e) => e.file)).toEqual(['k.yaml']);
  });
  it('the catalog cannot smuggle a vectis.* label or a credential into a native file', async () => {
    const s = source({ 'a.yaml': entry() }, { 'dags/a.yaml': 'labels: ["vectis.owner=x"]\nsteps:\n  - id: s\n    run: echo AKIAABCDEFGHIJKLMNOP\n' });
    const c = await loadCatalog(s, DEV);
    expect(c.jobs).toEqual([]);
    expect(c.errors[0].errors.join(' ')).toMatch(/belong to the portal/);
    expect(c.errors[0].errors.join(' ')).toMatch(/AWS access key/);
  });
});

describe('GitHub definition reads', () => {
  const calls: string[] = [];
  const src = () => githubSource({ repo: 'org/jobs', path: 'jobs', ref: 'main' }, 'tok', (async (u: string) => { calls.push(String(u)); return new Response('x: 1', { status: 200 }); }) as unknown as typeof fetch);
  it('pins the commit and builds the path from validated segments only', async () => {
    calls.length = 0;
    await src().readDefinition(SHA, 'dags/hello.yaml');
    expect(calls).toEqual([`https://api.github.com/repos/org/jobs/contents/jobs/dags/hello.yaml?ref=${SHA}`]);
  });
  it('refuses traversal, absolute and odd paths and a non-commit version without any request', async () => {
    calls.length = 0;
    for (const p of ['../x.yaml', 'dags/../../x.yaml', '/etc/passwd', 'dags//x.yaml', 'x.txt', 'dags/x.yaml?ref=evil', 'dags/%2e%2e/x.yaml', '.a/x.yaml', 'a/b/c/d/e/x.yaml', 'dags\\x.yaml', 'dags/x.yaml\n']) await expect(src().readDefinition(SHA, p), p).rejects.toThrow('bad request');
    await expect(src().readDefinition('main', 'dags/x.yaml')).rejects.toThrow('bad request');
    await expect(src().readDefinition(`${SHA}/../x`, 'dags/x.yaml')).rejects.toThrow('bad request');
    expect(calls).toEqual([]);
  });
});

describe('the TES runner refuses workflow jobs', () => {
  it('with a 400 and without calling anything', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const spec = { name: 'x', steps: [], inputs: [], outputs: [], tags: {}, secrets: [], warnings: [], dag: { engine: 'dagu', definition: GOOD, dag_name: 'a', params: {} } } as never;
    const e = await tesRunner.submit(spec, { user: 'u', token: 't' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RunnerError);
    expect((e as RunnerError).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});

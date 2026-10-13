/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
/**
 * CONTRACT TEST against a REAL, running Dagu server. Opt-in: skipped unless
 *   DAGU_CONTRACT_URL                            server root, e.g. http://127.0.0.1:8080   (the runner adds /api/v1)
 *   DAGU_BASIC_USER + DAGU_BASIC_PASSWORD        or      DAGU_TOKEN
 * are set, then:  npm run test:dagu
 *
 * The suite starts and cancels real runs and runs shell steps, so it refuses any host other than localhost unless
 * DAGU_CONTRACT_ALLOW_REMOTE=1 is also set: point it only at a disposable Dagu server, never at a shared or production one.
 * The server must allow the `command`, `http` and `jq` executors (the suite sets DAGU_ALLOWED_EXECUTORS for the runner itself).
 *
 * It drives the REAL adapter (createDaguRunner) and the real catalog loader/compiler; nothing is mocked. The definitions
 * are inline (testing/definitions.ts): none ship with the portal. If this fails after a Dagu upgrade, fix the adapter
 * (src/lib/jobs/dagu), not this test: it states what the portal needs from Dagu.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../catalog/load';
import type { CatalogSource } from '../catalog/source';
import { compileDagJob } from '../jobdef/compile';
import { isDagDef } from '../jobdef/types';
import type { LaunchSpec } from '../launch';
import type { Run } from '../model';
import { RunnerError } from '../runner';
import { createDaguRunner } from './daguRunner';
import { DAG_FANOUT, DAG_HELLO, DAG_SOC, ENTRY_FANOUT, ENTRY_HELLO, ENTRY_SOC } from '../testing/definitions';

const url = process.env.DAGU_CONTRACT_URL;
const haveCreds = !!process.env.DAGU_TOKEN || (!!process.env.DAGU_BASIC_USER && !!process.env.DAGU_BASIC_PASSWORD);
const localOnly = (() => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url ?? '').hostname); } catch { return false; } })();
const allowRemote = process.env.DAGU_CONTRACT_ALLOW_REMOTE === '1';
// The suite starts and cancels real runs and runs shell steps: it refuses a host that is not this machine unless told explicitly.
if (url && !localOnly && !allowRemote) throw new Error('DAGU_CONTRACT_URL must point at 127.0.0.1 or localhost; set DAGU_CONTRACT_ALLOW_REMOTE=1 to run against a disposable remote server');
const enabled = !!url && haveCreds;

const OWNER_KEY = randomBytes(32).toString('hex'); // per run; changing it would orphan runs (see README)
const env = (): Record<string, string | undefined> => ({
  NODE_ENV: 'test', JOBS_OWNER_HMAC_KEY: OWNER_KEY, DAGU_URL: url, DAGU_TOKEN: process.env.DAGU_TOKEN, DAGU_BASIC_USER: process.env.DAGU_BASIC_USER, DAGU_BASIC_PASSWORD: process.env.DAGU_BASIC_PASSWORD,
  DAGU_ALLOWED_EXECUTORS: 'command,http,jq',
});
const runner = createDaguRunner(env);
const alice = { user: `alice-${Date.now()}@example.org`, token: 'not-sent-to-dagu' };
const bob = { user: `bob-${Date.now()}@example.org`, token: 'not-sent-to-dagu' };

const ENTRIES: Record<string, string> = { 'dag-hello.yaml': ENTRY_HELLO, 'dag-fanout.yaml': ENTRY_FANOUT, 'dag-soc-enrich.yaml': ENTRY_SOC };
const NATIVE: Record<string, string> = { 'dags/hello.yaml': DAG_HELLO, 'dags/fanout.yaml': DAG_FANOUT, 'dags/soc-enrich-indicator.yaml': DAG_SOC };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function catalogSpec(job: string, params: Record<string, unknown> = {}): Promise<LaunchSpec> {
  const files = Object.keys(ENTRIES);
  const src: CatalogSource = {
    kind: 'github', repo: 'example/jobs', ref: 'main',
    list: async () => ({ version: 'd'.repeat(40), files: files.map((name) => ({ name, size: 1000 })), truncated: false }),
    read: async (_v, name) => ENTRIES[name],
    readDefinition: async (_v, p) => NATIVE[p],
  };
  const cat = await loadCatalog(src, env());
  const e = cat.jobs.find((j) => j.def.id === job);
  if (!e || !isDagDef(e.def) || !e.native) throw new Error(`catalog entry ${job} did not load: ${JSON.stringify(cat.errors)}`);
  const c = compileDagJob(e.def, e.native, params, { repo: 'example/jobs', sha: 'd'.repeat(40) });
  if (!c.ok) throw new RunnerError(400, 'refused', c.errors);
  return c.spec;
}
/** A spec from a definition written in the test (for behaviours the sample catalog entries do not have). */
const inline = (definition: string, name: string, params: Record<string, string> = {}): LaunchSpec => ({
  name, steps: [], inputs: [], outputs: [], secrets: [], warnings: [], tags: { 'vectis.job': 'contract' },
  dag: { engine: 'dagu', definition, dag_name: name, params },
});
async function settle(id: string, who = alice, timeoutMs = 60_000): Promise<Run> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await runner.get(id, who, { detail: 'full' });
    if (r.state === 'succeeded' || r.state === 'failed' || r.state === 'cancelled') return r;
    if (Date.now() > end) throw new Error(`run ${id} still ${r.state} after ${timeoutMs}ms`);
    await sleep(500);
  }
}
async function until(id: string, pred: (r: Run) => boolean, who = alice, timeoutMs = 30_000): Promise<Run> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await runner.get(id, who, { detail: 'full' });
    if (pred(r)) return r;
    if (Date.now() > end) throw new Error(`condition not met for ${id}; state ${r.state}`);
    await sleep(300);
  }
}
const failure = async (p: Promise<unknown>): Promise<RunnerError> => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(RunnerError);
  return e as RunnerError;
};
const direct = async (method: string, path: string, body?: unknown) => {
  const e = env();
  const auth = e.DAGU_TOKEN ? `Bearer ${e.DAGU_TOKEN}` : `Basic ${Buffer.from(`${e.DAGU_BASIC_USER}:${e.DAGU_BASIC_PASSWORD}`).toString('base64')}`;
  const r = await fetch(`${url}/api/v1${path}`, { method, headers: { authorization: auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as unknown };
};

const SLEEPER = 'name: contract-sleeper\ntype: graph\nsteps:\n  - id: nap\n    run: sleep 120\n  - id: after\n    depends: [nap]\n    run: echo never\n';
const FAILING = 'name: contract-failing\ntype: graph\nsteps:\n  - id: ok\n    run: echo fine\n  - id: boom\n    depends: [ok]\n    run: "echo oops >&2; exit 3"\n  - id: after\n    depends: [boom]\n    run: echo never\n';

describe.skipIf(!enabled)('adapter vs a REAL Dagu server', () => {
  it('reports the server version (record this as "tested with")', async () => {
    const info = await runner.info(alice);
    console.log(`[contract] Dagu server version: ${info?.version}`);
    expect(info?.name).toBe('Dagu');
    expect(info?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('Dagu itself accepts all three sample native definitions (its own validator)', async () => {
    for (const [f, spec] of Object.entries(NATIVE)) {
      const r = await direct('POST', '/dags/validate', { spec });
      expect(r.status, f).toBe(200);
      expect(r.json, f).toMatchObject({ valid: true });
    }
  });

  it('submit hello -> poll to success -> steps, dependencies, logs, timestamps', async () => {
    const { id, warnings } = await runner.submit(await catalogSpec('dag-hello'), alice);
    expect(id).toMatch(/^hello\.[A-Za-z0-9_-]{22}$/);
    expect(warnings).toEqual([]);
    const quick = await settle(id);
    // a finished, successful run: the default get fetches no logs (bounded); they are loaded for exactly the steps asked for
    expect(quick.steps.map((s) => [s.stdout, s.logs_loaded])).toEqual([['', false], ['', false]]);
    const run = await runner.get(id, alice, { detail: 'full', steps: ['greet', 'finish'] });
    expect(run).toMatchObject({ id, backend: 'dagu', name: 'hello', job: 'dag-hello', state: 'succeeded', backend_state: 'succeeded' });
    expect(run.submitted_by).toBe(alice.user.toLowerCase().replace(/[^a-z0-9_./-]/g, '_').slice(0, 64));
    expect(run.steps.map((s) => [s.name, s.state, s.depends_on, s.exit_code])).toEqual([['greet', 'succeeded', [], 0], ['finish', 'succeeded', ['greet'], 0]]);
    expect(run.steps[0].stdout.trim()).toBe('Hello from Vectis Jobs');
    expect(run.steps[1].stdout.trim()).toBe('done');
    expect(run.created_at && run.started_at && run.ended_at).toBeTruthy();
    expect(Date.parse(run.ended_at as string)).toBeGreaterThanOrEqual(Date.parse(run.started_at as string));
    expect(run.tags).toMatchObject({ 'vectis.job': 'dag-hello', 'vectis.catalog_repo': 'example/jobs' });
    expect(JSON.stringify(run)).not.toMatch(/vectis\.owner|\/var\/lib/);
    // the summary form carries no logs
    const summary = await runner.get(id, alice, { detail: 'summary' });
    expect(summary.steps[0].stdout).toBe('');
  });

  it('fan-out / fan-in: depends_on is exactly the DAG, and the param is passed and visible in logs and in the run', async () => {
    const { id } = await runner.submit(await catalogSpec('dag-fanout', { label: 'contract_42' }), alice);
    expect((await settle(id)).state).toBe('succeeded');
    const run = await runner.get(id, alice, { detail: 'full', steps: ['branch_a', 'branch_b', 'branch_c', 'join'] });
    const by = Object.fromEntries(run.steps.map((s) => [s.name, s]));
    expect(Object.keys(by).sort()).toEqual(['branch_a', 'branch_b', 'branch_c', 'join']);
    for (const b of ['branch_a', 'branch_b', 'branch_c']) { expect(by[b].depends_on).toEqual([]); expect(by[b].stdout).toContain('contract_42'); }
    expect(by.join.depends_on.sort()).toEqual(['branch_a', 'branch_b', 'branch_c']);
    expect(by.join.stdout).toContain('joined contract_42');
    expect(run.params).toEqual({ label: 'contract_42' });
  });

  it('a failing step -> failed run, the step failed with its error and exit code and stderr, downstream did not run', async () => {
    const { id } = await runner.submit(inline(FAILING, 'contract-failing'), alice);
    const run = await settle(id);
    expect(run.state).toBe('failed');
    const by = Object.fromEntries(run.steps.map((s) => [s.name, s]));
    expect(by.ok.state).toBe('succeeded');
    expect(by.boom).toMatchObject({ state: 'failed', exit_code: 3 });
    expect(by.boom.error).toMatch(/exit status 3/);
    expect(by.boom.stderr).toContain('oops');
    expect(by.after.state).toBe('cancelled');
    expect(by.after.exit_code).toBeNull();
  });

  it('cancel a long-running sleep -> cancelled; cancelling again is 409', async () => {
    const { id } = await runner.submit(inline(SLEEPER, 'contract-sleeper'), alice);
    const running = await until(id, (r) => r.state === 'running' && r.steps[0].state === 'running');
    expect(running.steps[1].state).toBe('queued');
    await runner.cancel(id, alice);
    const done = await settle(id, alice, 30_000);
    expect(done.state).toBe('cancelled');
    expect(done.steps[0].state).toBe('cancelled');
    expect((await failure(runner.cancel(id, alice))).status).toBe(409);
  });

  it('a hostile parameter is refused before it reaches Dagu (compile, and again in the runner)', async () => {
    const before = (await runner.list({ page_size: 500 }, alice)).runs.length;
    for (const v of ['a;touch /tmp/pwned', '$(id)', '`id`', 'a b', 'a|b', 'a&b', "a'b", '-rf', 'a\nb']) {
      const e = await failure(catalogSpec('dag-fanout', { label: v }));
      expect(e.status, JSON.stringify(v)).toBe(400);
    }
    // bypassing the compiler: hand the runner a spec with a hostile value
    const hostile = await catalogSpec('dag-fanout', { label: 'fine' });
    for (const v of ['a;b', '$(id)', 'a b', '`x`']) {
      const e = await failure(runner.submit({ ...hostile, dag: { ...(hostile.dag as NonNullable<LaunchSpec['dag']>), params: { label: v } } }, alice));
      expect(e.status, JSON.stringify(v)).toBe(400);
    }
    expect((await runner.list({ page_size: 500 }, alice)).runs.length).toBe(before);
  });

  it('two identities cannot see or cancel each other\'s runs, including with crafted ids', async () => {
    const { id } = await runner.submit(inline(SLEEPER, 'contract-sleeper'), alice);
    await until(id, (r) => r.state === 'running');
    expect((await runner.list({ page_size: 500 }, alice)).runs.map((r) => r.id)).toContain(id);
    expect((await runner.list({ page_size: 500 }, bob)).runs.map((r) => r.id)).not.toContain(id);
    expect((await failure(runner.get(id, bob))).status).toBe(404);
    expect((await failure(runner.cancel(id, bob))).status).toBe(404);
    const [name, rid] = id.split('.');
    for (const crafted of [`${name}.latest`, `${name}.LATEST`, `${name}.${rid}.x`, `${name}/${rid}`, `${name}.${rid}/../${rid}`]) {
      expect([400, 404], crafted).toContain((await failure(runner.get(crafted, bob))).status);
      expect([400, 404], crafted).toContain((await failure(runner.cancel(crafted, bob))).status);
    }
    // Dagu's own "latest" alias would have resolved to alice's newest run if it had been forwarded:
    expect(await direct('GET', `/dag-runs/${name}/latest`)).toMatchObject({ status: 200 }); // the alias exists on the server...
    expect((await failure(runner.get(`${name}.latest`, bob))).status).toBe(400); // ...and the adapter never forwards it
    // alice's run is untouched by bob's attempts, and she can still cancel it
    expect((await runner.get(id, alice)).state).toBe('running');
    await runner.cancel(id, alice);
    expect((await settle(id, alice, 30_000)).state).toBe('cancelled');
  });

  it('a user whose name has characters Dagu labels cannot hold still gets a working, private run', async () => {
    const weird = { user: `Weird.User+tag-${Date.now()}@Example.ORG`, token: 't' };
    const { id } = await runner.submit(await catalogSpec('dag-hello'), weird);
    expect((await settle(id, weird)).submitted_by).toMatch(/^weird\.user_tag-\d+_example\.org$/);
    expect((await failure(runner.get(id, alice))).status).toBe(404);
  });

  it('list filters by state and pages with Dagu\'s cursor', async () => {
    const who = { user: `pager-${Date.now()}@example.org`, token: 't' };
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await runner.submit(await catalogSpec('dag-hello'), who)).id);
    for (const id of ids) await settle(id, who);
    const p1 = await runner.list({ page_size: 2 }, who);
    expect(p1.runs).toHaveLength(2);
    expect(p1.next_page_token).toBeTruthy();
    const p2 = await runner.list({ page_size: 2, page_token: p1.next_page_token as string }, who);
    expect([...p1.runs, ...p2.runs].map((r) => r.id).sort()).toEqual([...ids].sort());
    expect((await runner.list({ state: 'succeeded', page_size: 10 }, who)).runs).toHaveLength(3);
    expect((await runner.list({ state: 'failed', page_size: 10 }, who)).runs).toEqual([]);
    expect((await runner.list({ state: 'running', page_size: 10 }, who)).runs).toEqual([]);
  });

  it('Dagu refuses a repeated run id (409): the idempotency the runner relies on', async () => {
    const spec = inline('name: contract-dup\nsteps:\n  - id: a\n    run: echo x\n', 'contract-dup');
    const body = { spec: spec.dag?.definition, dagRunId: `dup${Date.now()}`, labels: [] as string[] };
    expect((await direct('POST', '/dag-runs', body)).status).toBe(200);
    expect((await direct('POST', '/dag-runs', body)).status).toBe(409);
  });

  it('the service credential is required: a wrong one is a 502 for the user, never a 401', async () => {
    const bad = createDaguRunner(() => ({ ...env(), DAGU_TOKEN: 'wrong-token', DAGU_BASIC_USER: undefined, DAGU_BASIC_PASSWORD: undefined }));
    const e = await failure(bad.list({}, alice));
    expect(e.status).toBe(502);
    expect(e.message).not.toMatch(/wrong-token/);
  });
});

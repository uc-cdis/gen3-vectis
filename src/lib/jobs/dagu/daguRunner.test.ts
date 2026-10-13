/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { LaunchSpec } from '../launch';
import { RunnerError } from '../runner';
import { getRunner } from '../select';
import { createDaguRunner, ownerHash } from './daguRunner';
import { createFakeDagu } from '@/lib/jobs/testing/fakeDagu';
import { DAG_FANOUT } from '../testing/definitions';

const SECRET = 'S3cretServiceToken-0123456789';
const BASIC = `Basic ${Buffer.from('svc:p4ssw0rd-xyz').toString('base64')}`;
const KEY = 'k'.repeat(40);
const ENV = { NODE_ENV: 'test', JOBS_OWNER_HMAC_KEY: KEY, DAGU_URL: 'http://dagu.test:8080', DAGU_TOKEN: SECRET, DAGU_ALLOWED_EXECUTORS: 'command,http,jq' };
const alice = { user: 'alice@example.org', token: 'alice-bearer-token' };
const bob = { user: 'bob@example.org', token: 'bob-bearer-token' };

const spec = (over: Partial<NonNullable<LaunchSpec['dag']>> = {}, tags: Record<string, string> = {}): LaunchSpec => ({
  name: 'Fan-out', steps: [], inputs: [], outputs: [], secrets: [], warnings: ['w1'],
  dag: { engine: 'dagu', definition: DAG_FANOUT, dag_name: 'fanout', params: { label: 'alpha' }, ...over },
  tags: { 'vectis.job': 'dag-fanout', 'vectis.catalog_sha': 'a'.repeat(40), 'vectis.catalog_repo': 'org/jobs', ...tags },
});

let fake: ReturnType<typeof createFakeDagu>;
let env: Record<string, string | undefined>;
const runner = () => createDaguRunner(() => env);
beforeEach(() => { env = { ...ENV }; fake = createFakeDagu({ authorization: `Bearer ${SECRET}` }); vi.stubGlobal('fetch', fake.fetch); });
afterEach(() => vi.unstubAllGlobals());

const failure = async (p: Promise<unknown>): Promise<RunnerError> => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(RunnerError);
  return e as RunnerError;
};

describe('registry', () => {
  it("is selectable as JOBS_RUNNER=dagu and nothing else changed", () => {
    expect(getRunner({ JOBS_RUNNER: 'dagu' }).id).toBe('dagu');
    expect(getRunner({}).id).toBe('tes');
  });
});

describe('configuration (fail closed)', () => {
  it('is "not configured" (503) without a url or without credentials, and never calls out', async () => {
    for (const patch of [{ DAGU_URL: undefined }, { DAGU_TOKEN: undefined }, { DAGU_URL: '' }, { DAGU_URL: 'not a url' }]) {
      env = { ...ENV, ...patch };
      expect((await failure(runner().list({}, alice))).status).toBe(503);
    }
    expect(fake.calls).toHaveLength(0);
  });
  it('refuses both a token and basic credentials (ambiguous), and half of a basic pair', async () => {
    for (const patch of [{ DAGU_BASIC_USER: 'u', DAGU_BASIC_PASSWORD: 'p' }, { DAGU_TOKEN: undefined, DAGU_BASIC_USER: 'u' }, { DAGU_TOKEN: undefined, DAGU_BASIC_PASSWORD: 'p' }, { DAGU_TOKEN: undefined, DAGU_BASIC_USER: 'a:b', DAGU_BASIC_PASSWORD: 'p' }, { DAGU_TOKEN: 'has space' }, { DAGU_TOKEN: 'x\r\nInjected: 1' }]) {
      env = { ...ENV, ...patch };
      expect((await failure(runner().list({}, alice))).status, JSON.stringify(Object.keys(patch))).toBe(503);
    }
    expect(fake.calls).toHaveLength(0);
  });
  it('no credentials, query or fragment in the url', async () => {
    for (const u of ['http://u:p@dagu.test', 'http://dagu.test?x=1', 'http://dagu.test#f', 'ftp://dagu.test', 'file:///x']) {
      env = { ...ENV, DAGU_URL: u };
      expect((await failure(runner().list({}, alice))).status, u).toBe(503);
    }
  });
  it('PRODUCTION requires https; plain http only for a cluster-local host AND DAGU_ALLOW_CLUSTER_HTTP=yes', async () => {
    const prod = { ...ENV, NODE_ENV: 'production' };
    for (const u of ['http://dagu.test:8080', 'http://dagu.vectis.svc:8080', 'http://dagu.vectis.svc.cluster.local:8080', 'http://svc:8080', 'http://dagu.svc.evil.com', 'http://evilsvc', 'http://127.0.0.1:8080', 'http://localhost:8080']) {
      env = { ...prod, DAGU_URL: u };
      expect((await failure(runner().list({}, alice))).status, u).toBe(503);
    }
    for (const u of ['http://dagu.test:8080', 'http://127.0.0.1:8080', 'http://dagu.svc.evil.com', 'http://evil.com/x.svc']) {
      env = { ...prod, DAGU_URL: u, DAGU_ALLOW_CLUSTER_HTTP: 'yes' };
      expect((await failure(runner().list({}, alice))).status, `flag but ${u}`).toBe(503);
    }
    for (const flag of [undefined, 'true', '1', 'YES', 'y']) {
      env = { ...prod, DAGU_URL: 'http://dagu.vectis.svc:8080', DAGU_ALLOW_CLUSTER_HTTP: flag };
      expect((await failure(runner().list({}, alice))).status, `host ok but flag ${flag}`).toBe(503);
    }
    expect(fake.calls).toHaveLength(0);
    for (const u of ['http://dagu.vectis.svc:8080', 'http://dagu.vectis.svc.cluster.local:8080']) {
      env = { ...prod, DAGU_URL: u, DAGU_ALLOW_CLUSTER_HTTP: 'yes' };
      await runner().list({}, alice);
    }
    env = { ...prod, DAGU_URL: 'https://dagu.example.org' };
    await runner().list({}, alice);
    expect(fake.calls.map((c) => c.path.split('?')[0])).toEqual(['/api/v1/dag-runs', '/api/v1/dag-runs', '/api/v1/dag-runs']);
  });
  it('production detection is fail closed: unset or odd NODE_ENV counts as production', async () => {
    for (const NODE_ENV of [undefined, '', 'staging', 'Production', 'prod']) {
      env = { ...ENV, NODE_ENV };
      expect((await failure(runner().list({}, alice))).status, String(NODE_ENV)).toBe(503);
    }
    for (const NODE_ENV of ['development', 'test']) { env = { ...ENV, NODE_ENV }; await runner().list({}, alice); }
  });
  it('accepts the url with a trailing /api/v1 or slash, and keeps a reverse-proxy base path', async () => {
    env = { ...ENV, DAGU_URL: 'http://dagu.test:8080/api/v1/' };
    await runner().list({}, alice);
    env = { ...ENV, DAGU_URL: 'http://dagu.test:8080/dagu/' };
    await runner().list({}, alice);
    const urls = fake.calls.map((c) => c.path);
    expect(urls[0].startsWith('/api/v1/dag-runs')).toBe(true);
    expect(urls[1].startsWith('/dagu/api/v1/dag-runs') || urls[1].startsWith('/api/v1')).toBe(true);
  });
  it('sends Basic credentials when configured that way', async () => {
    fake = createFakeDagu({ authorization: BASIC }); vi.stubGlobal('fetch', fake.fetch);
    env = { ...ENV, DAGU_TOKEN: undefined, DAGU_BASIC_USER: 'svc', DAGU_BASIC_PASSWORD: 'p4ssw0rd-xyz' };
    await runner().list({}, alice);
    expect(fake.calls[0].headers.authorization).toBe(BASIC);
  });
});

describe('submit', () => {
  it('creates ONE run from the INLINE native definition, unchanged, with the portal labels and params', async () => {
    const r = runner();
    const out = await r.submit(spec(), alice);
    expect(fake.calls).toHaveLength(1);
    const c = fake.calls[0];
    expect(c.method).toBe('POST');
    expect(c.path).toBe('/api/v1/dag-runs');
    const b = c.body as { spec: string; name: string; params: string; dagRunId: string; labels: string[] };
    expect(parse(b.spec)).toEqual(parse(DAG_FANOUT)); // the same document (it is re-serialised from the linted object; see daguRunner.security.test.ts)
    expect(JSON.parse(b.params)).toEqual({ label: 'alpha' });
    expect(b.dagRunId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(b.labels).toEqual(expect.arrayContaining(['vectis.job=dag-fanout', `vectis.catalog_sha=${'a'.repeat(40)}`, 'vectis.catalog_repo=org/jobs', 'vectis.submitted_by=alice_example.org', `vectis.owner=${ownerHash('alice@example.org', KEY)}`]));
    expect(Object.keys(b).sort()).toEqual(['dagRunId', 'labels', 'name', 'params', 'spec']);
    expect(out).toEqual({ id: `fanout.${b.dagRunId}`, warnings: ['w1'] });
    expect(fake.runs).toHaveLength(1);
  });
  it('uses a fresh random run id every time (128 bits), so a retry can never collide with another user', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) ids.add((await runner().submit(spec(), alice)).id);
    expect(ids.size).toBe(20);
  });
  it('sends the SERVICE credential only: never the user bearer, a cookie, or an identity header', async () => {
    await runner().submit(spec(), alice);
    await runner().list({}, alice);
    for (const c of fake.calls) {
      expect(Object.keys(c.headers).sort()).toEqual(c.method === 'POST' ? ['accept', 'authorization', 'content-type'] : ['accept', 'authorization']);
      expect(c.headers.authorization).toBe(`Bearer ${SECRET}`);
      expect(JSON.stringify(c)).not.toContain('alice-bearer-token');
    }
  });
  it('never follows redirects and never puts the credential anywhere but the header', async () => {
    const seen: RequestInit[] = [];
    fake = createFakeDagu({ authorization: `Bearer ${SECRET}`, onRequest: (_m, _u, init) => seen.push(init) }); vi.stubGlobal('fetch', fake.fetch);
    await runner().submit(spec(), alice);
    expect(seen.every((i) => i.redirect === 'error')).toBe(true);
    expect(JSON.stringify(fake.calls.map((c) => [c.path, c.body]))).not.toContain(SECRET);
  });
  it('drops every client-looking tag; owner and submitter come only from the verified user', async () => {
    await runner().submit(spec({}, { 'vectis.owner': 'forged', 'vectis.submitted_by': 'mallory', 'Vectis.Owner': 'forged-two', 'x.other': 'y', 'vectis.catalog_sha': 'b'.repeat(40) }), alice);
    const labels = (fake.calls[0].body as { labels: string[] }).labels;
    expect(labels.filter((l) => l.startsWith('vectis.owner='))).toEqual([`vectis.owner=${ownerHash('alice@example.org', KEY)}`]);
    expect(labels.filter((l) => l.startsWith('vectis.submitted_by='))).toEqual(['vectis.submitted_by=alice_example.org']);
    expect(labels.some((l) => /forged|mallory|x\.other/.test(l))).toBe(false);
    expect(labels).toHaveLength(5);
  });
  it('a definition that declares its own vectis.* label is refused (and so is a forged label in a native file)', async () => {
    const def = DAG_FANOUT.replace('type: graph', 'type: graph\nlabels: ["vectis.owner=someoneelse"]');
    const e = await failure(runner().submit(spec({ definition: def }), alice));
    expect(e.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });
  it('refuses a container (TES-style) job: Dagu runs workflow jobs only', async () => {
    const s = { ...spec(), dag: undefined, steps: [{ image: 'alpine', command: ['echo'] }] } as LaunchSpec;
    expect((await failure(runner().submit(s, alice))).status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });
  it('lints the definition AGAIN with this server\'s executor policy before sending', async () => {
    env = { ...ENV, DAGU_ALLOWED_EXECUTORS: undefined }; // default: command is off
    const e = await failure(runner().submit(spec(), alice));
    expect(e.status).toBe(400);
    expect(e.details.join(' ')).toMatch(/"command" executor is not enabled/);
    expect(fake.calls).toHaveLength(0);
  });
  it('refuses hostile params before anything is sent', async () => {
    for (const v of ['a b', 'a;b', 'a|b', 'a&b', '$(id)', '`id`', 'a"b', "a'b", 'a<b', 'a>b', 'a(b', 'a{b', 'a\\b', 'a\nb', 'a\u0000b', 'a*b', 'a!b', '${x}', '']) {
      if (v === '') continue;
      const e = await failure(runner().submit(spec({ params: { label: v } }), alice));
      expect(e.status, JSON.stringify(v)).toBe(400);
    }
    expect((await failure(runner().submit(spec({ params: { 'bad name': 'x' } }), alice))).status).toBe(400);
    expect((await failure(runner().submit(spec({ params: { undeclared: 'x' } }), alice))).status).toBe(400); // not declared natively
    expect(fake.calls).toHaveLength(0);
  });
  it('a lost answer after Dagu accepted the run is not reported as a failure; a refused POST is', async () => {
    let first = true;
    const real = fake.fetch;
    vi.stubGlobal('fetch', (async (u: string, i: RequestInit) => {
      const r = await real(u, i);
      if (first && i.method === 'POST') { first = false; throw new TypeError('connection reset'); }
      return r;
    }) as typeof fetch);
    const out = await runner().submit(spec(), alice);
    expect(out.id).toMatch(/^fanout\./);
    expect(fake.runs).toHaveLength(1); // exactly one run, not two
    vi.stubGlobal('fetch', (async () => { throw new TypeError('down'); }) as typeof fetch);
    expect((await failure(runner().submit(spec(), alice))).status).toBe(502);
  });
  it('maps Dagu errors to safe messages without echoing Dagu text', async () => {
    const leak = '/var/lib/dagu/secret-path SECRETDETAIL';
    const f = (status: number) => vi.fn(async () => new Response(JSON.stringify({ message: leak }), { status })) as unknown as typeof fetch;
    for (const [status, want] of [[400, 400], [401, 502], [403, 502], [409, 502], [429, 429], [500, 502], [503, 502], [418, 502]] as const) {
      vi.stubGlobal('fetch', f(status));
      const e = await failure(runner().submit(spec(), alice));
      expect(e.status, String(status)).toBe(want);
      expect(JSON.stringify([e.message, e.details])).not.toMatch(/SECRETDETAIL|\/var\/lib/);
    }
  });
  it('a response that answers with a different run id is not trusted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ dagRunId: 'someone-elses' }), { status: 200 })) as unknown as typeof fetch);
    expect((await failure(runner().submit(spec(), alice))).status).toBe(502);
  });
});

describe('OWNERSHIP: two identities', () => {
  const submit = async (who: typeof alice, label = 'x') => (await runner().submit(spec({ params: { label } }), who)).id;

  it('list returns only the caller\'s runs, even when the server ignores the label filter', async () => {
    fake = createFakeDagu({ authorization: `Bearer ${SECRET}`, ignoreLabelFilter: true }); vi.stubGlobal('fetch', fake.fetch);
    const a1 = await submit(alice, 'a1'); const b1 = await submit(bob, 'b1'); const a2 = await submit(alice, 'a2');
    const la = (await runner().list({}, alice)).runs.map((r) => r.id).sort();
    const lb = (await runner().list({}, bob)).runs.map((r) => r.id);
    expect(la).toEqual([a1, a2].sort());
    expect(lb).toEqual([b1]);
    expect((await runner().list({}, { user: 'carol@example.org', token: 't' })).runs).toEqual([]);
  });
  it('asks Dagu to filter by the caller\'s owner label (and pages with the same filter)', async () => {
    await submit(alice);
    await runner().list({ page_size: 7, state: 'running' }, alice);
    const q = new URL(`http://x${fake.calls.at(-1)?.path}`).searchParams;
    expect(q.getAll('labels')).toEqual([`vectis.owner=${ownerHash('alice@example.org', KEY)}`]);
    expect(q.get('limit')).toBe('7');
    expect(q.getAll('status')).toEqual(['1', '7']);
  });
  it('get/cancel of another user\'s run is 404, identical to a run that does not exist, and cancel never reaches Dagu', async () => {
    const a1 = await submit(alice);
    const nonexistent = await failure(runner().get('fanout.doesnotexist', bob));
    const g = await failure(runner().get(a1, bob));
    const c = await failure(runner().cancel(a1, bob));
    expect([g.status, g.message]).toEqual([nonexistent.status, nonexistent.message]);
    expect([c.status, c.message]).toEqual([404, 'Run not found.']);
    expect(fake.calls.some((x) => x.path.endsWith('/stop'))).toBe(false);
    expect(fake.runs[0].stopped).toBeUndefined();
    await runner().cancel(a1, alice);
    expect(fake.runs[0].stopped).toBe(true);
  });
  it('crafted ids cannot reach another user\'s run or another endpoint', async () => {
    const a1 = await submit(alice);
    const [name, id] = a1.split('.');
    const crafted = [`${name}.latest`, `${name}.LATEST`, `${name}.${id}/../${id}`, `${name}.${id}%2f..`, `${name}/${id}`, `..`, `${name}.${id}.extra`, `.${id}`, `${name}.`, '', `${name}.${id}?x=1`, `${name}.${'a'.repeat(65)}`, `${'n'.repeat(65)}.${id}`, `${name}.${id}\n`, `${name}.${id}:cancel`, `${name} .${id}`];
    for (const bad of crafted) {
      expect([400, 404], JSON.stringify(bad)).toContain((await failure(runner().get(bad, bob))).status);
      expect([400, 404], JSON.stringify(bad)).toContain((await failure(runner().cancel(bad, bob))).status);
    }
    // the "latest" alias would resolve to alice's newest run: it must be refused before any call is made
    const before = fake.calls.length;
    expect((await failure(runner().get(`${name}.latest`, alice))).status).toBe(400);
    expect(fake.calls.length).toBe(before);
    expect(fake.calls.every((x) => !/\/latest|\.\.|%2f/i.test(x.path))).toBe(true);
    expect(fake.runs[0].stopped).toBeUndefined();
  });
  it('a run with no owner label, a foreign one, or TWO owner labels is nobody\'s', async () => {
    const mine = ownerHash('alice@example.org', KEY);
    fake.runs.push({ name: 'fanout', id: 'nolabel', labels: [], params: '', status: 1, label: 'running', nodes: [], created: 0 });
    fake.runs.push({ name: 'fanout', id: 'foreign', labels: [`vectis.owner=${ownerHash('bob@example.org', KEY)}`], params: '', status: 1, label: 'running', nodes: [], created: 1 });
    fake.runs.push({ name: 'fanout', id: 'two', labels: [`vectis.owner=${mine}`, `vectis.owner=${ownerHash('bob@example.org', KEY)}`], params: '', status: 1, label: 'running', nodes: [], created: 2 });
    fake.runs.push({ name: 'fanout', id: 'upper', labels: [`vectis.owner=${mine.toUpperCase()}`], params: '', status: 1, label: 'running', nodes: [], created: 3 });
    fake.runs.push({ name: 'fanout', id: 'prefix', labels: [`vectis.owner=${mine.slice(0, 40)}`], params: '', status: 1, label: 'running', nodes: [], created: 4 });
    fake.runs.push({ name: 'fanout', id: 'mine', labels: [`vectis.owner=${mine}`], params: '', status: 1, label: 'running', nodes: [], created: 5 });
    for (const id of ['nolabel', 'foreign', 'two', 'prefix']) expect((await failure(runner().get(`fanout.${id}`, alice))).status, id).toBe(404);
    expect((await failure(runner().get('fanout.upper', alice))).status).toBe(404); // hash compare is exact (Dagu lower-cases, the portal hash is lower-case hex)
    expect((await runner().get('fanout.mine', alice)).id).toBe('fanout.mine');
    fake = createFakeDagu({ authorization: `Bearer ${SECRET}`, ignoreLabelFilter: true }); vi.stubGlobal('fetch', fake.fetch);
    fake.runs.push({ name: 'fanout', id: 'nolabel', labels: [], params: '', status: 1, label: 'running', nodes: [], created: 0 }, { name: 'fanout', id: 'mine', labels: [`vectis.owner=${mine}`], params: '', status: 1, label: 'running', nodes: [], created: 1 });
    expect((await runner().list({}, alice)).runs.map((r) => r.id)).toEqual(['fanout.mine']);
  });
  it('two users whose display names collapse to the same text still do not see each other', async () => {
    const x = { user: 'a.b@example.org', token: 't' }; const y = { user: 'a_b@example.org', token: 't' };
    const rx = await submit(x);
    expect((await failure(runner().get(rx, y))).status).toBe(404);
    expect((await runner().list({}, y)).runs).toEqual([]);
    expect((await runner().get(rx, x)).submitted_by).toBe('a.b_example.org');
  });
  it('an upstream answer about a different run than the one asked for is a 404', async () => {
    const a1 = await submit(alice);
    const real = fake.fetch;
    vi.stubGlobal('fetch', (async (u: string, i: RequestInit) => {
      const r = await real(u, i);
      if (/\/dag-runs\/fanout\/[^/]+$/.test(String(u)) && i.method === 'GET') {
        const body = (await r.json()) as { dagRunDetails: Record<string, unknown> };
        return new Response(JSON.stringify({ dagRunDetails: { ...body.dagRunDetails, dagRunId: 'other', name: 'fanout' } }), { status: 200 });
      }
      return r;
    }) as typeof fetch);
    expect((await failure(runner().get(a1, alice))).status).toBe(404);
  });
  it('an empty or missing verified identity is refused (never hashed into a shared owner)', async () => {
    for (const user of ['', '   ']) {
      expect((await failure(runner().list({}, { user, token: 't' }))).status).toBe(403);
      expect((await failure(runner().submit(spec(), { user, token: 't' }))).status).toBe(403);
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe('list and get mapping', () => {
  it('maps a run with steps, dependencies, states, params, tags and timestamps', async () => {
    const id = (await runner().submit(spec({ params: { label: 'zeta' } }), alice)).id;
    const [name, rid] = id.split('.');
    fake.settle(name, rid, 2, { branch_a: 4, branch_b: 2, branch_c: 4, join: 3 }, { branch_b: 'exit status 3' });
    fake.logs.set(`${name}/${rid}/branch_a`, { stdout: 'branch a for zeta\n', stderr: '' });
    const run = await runner().get(id, alice, { steps: ['branch_a'] });
    expect(run).toMatchObject({ id, backend: 'dagu', name: 'fanout', job: 'dag-fanout', submitted_by: 'alice_example.org', state: 'failed', backend_state: 'failed', created_at: '2026-10-12T15:59:59Z', params: { label: 'zeta' } });
    expect(run.steps.map((s) => [s.name, s.state, s.depends_on])).toEqual([
      ['branch_a', 'succeeded', []], ['branch_b', 'failed', []], ['branch_c', 'succeeded', []], ['join', 'cancelled', ['branch_a', 'branch_b', 'branch_c']],
    ]);
    expect(run.steps[0]).toMatchObject({ exit_code: 0, stdout: 'branch a for zeta\n', image: 'command', command: ['echo', 'hi'] });
    expect(run.steps[1]).toMatchObject({ exit_code: 3, error: 'exit status 3' });
    expect(run.tags).toMatchObject({ 'vectis.job': 'dag-fanout', 'vectis.catalog_repo': 'org/jobs' });
    expect(Object.keys(run.tags).some((k) => k === 'vectis.owner')).toBe(false); // the hash is not shown
    expect(JSON.stringify(run)).not.toContain(ownerHash('alice@example.org', KEY));
  });
  it('summary detail fetches no logs; full fetches stdout and stderr per started step', async () => {
    const id = (await runner().submit(spec(), alice)).id;
    await runner().get(id, alice, { detail: 'summary' });
    expect(fake.calls.filter((c) => c.path.includes('/log'))).toHaveLength(0);
    await runner().get(id, alice, { detail: 'full' });
    const logCalls = fake.calls.filter((c) => c.path.includes('/log'));
    expect(logCalls).toHaveLength(8); // 4 steps x (stdout, stderr)
    expect(logCalls.every((c) => /\/steps\/[A-Za-z0-9_-]+\/log\?stream=(stdout|stderr)&head=2000$/.test(c.path))).toBe(true);
  });
  it('list: paging cursor, state filter, name prefix, tag filter, page cap', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await runner().submit(spec(), alice)).id);
    fake.settle('fanout', ids[0].split('.')[1], 4);
    const p1 = await runner().list({ page_size: 2 }, alice);
    expect(p1.runs).toHaveLength(2);
    expect(p1.next_page_token).toBe('2');
    expect((await runner().list({ page_size: 2, page_token: '2' }, alice)).runs).toHaveLength(1);
    expect((await runner().list({ state: 'succeeded' }, alice)).runs.map((r) => r.id)).toEqual([ids[0]]);
    expect((await runner().list({ state: 'queued' }, alice)).runs).toEqual([]);
    expect((await runner().list({ name_prefix: 'zzz' }, alice)).runs).toEqual([]);
    expect((await runner().list({ name_prefix: 'fan' }, alice)).runs).toHaveLength(3);
    expect((await runner().list({ tag_key: ['vectis.job'], tag_value: ['dag-fanout'] }, alice)).runs).toHaveLength(3);
    expect((await runner().list({ tag_key: ['vectis.job'], tag_value: ['other'] }, alice)).runs).toEqual([]);
    await runner().list({ page_size: 5000 }, alice);
    expect(new URL(`http://x${fake.calls.at(-1)?.path}`).searchParams.get('limit')).toBe('500');
  });
  it('cancel: stops an active run; a finished one is 409 and nothing is sent', async () => {
    const id = (await runner().submit(spec(), alice)).id;
    const [name, rid] = id.split('.');
    await runner().cancel(id, alice);
    expect(fake.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/v1/dag-runs/${name}/${rid}/stop` });
    const n = fake.calls.length;
    const e = await failure(runner().cancel(id, alice)); // now `aborted` -> cancelled -> finished
    expect(e.status).toBe(409);
    expect(fake.calls.length).toBe(n + 1); // only the ownership read
    expect((await runner().get(id, alice)).state).toBe('cancelled');
  });
  it('info reports only name and version', async () => {
    expect(await runner().info(alice)).toEqual({ name: 'Dagu', version: '2.19.1' });
  });
});

describe('untrusted responses', () => {
  const answer = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch);
  const ownLabels = () => [`vectis.owner=${ownerHash('alice@example.org', KEY)}`];
  it('sanitises and caps logs (control chars, bidi, 64KB) and says when it cut', async () => {
    const id = (await runner().submit(spec(), alice)).id;
    const [name, rid] = id.split('.');
    fake.logs.set(`${name}/${rid}/branch_a`, { stdout: `ok\u001b[31mred‮\u0000${'x'.repeat(200_000)}`, stderr: '<script>alert(1)</script>' });
    const a = (await runner().get(id, alice)).steps[0];
    expect(a.stdout.length).toBeLessThanOrEqual(64 * 1024);
    expect(a.stdout).not.toMatch(/[\p{Cc}‮]/u);
    expect(a.truncated).toBe(true);
    expect(a.stderr).toBe('<script>alert(1)</script>'); // plain text; the UI renders it as text
  });
  it('redacts absolute server paths from step errors but keeps the message', async () => {
    const id = (await runner().submit(spec(), alice)).id;
    const [name, rid] = id.split('.');
    fake.settle(name, rid, 2, { branch_a: 2 }, { branch_a: 'failed to set up step: jq: parsing JSON from input file "/var/lib/dagu/logs/x/y.out": invalid character' });
    const s = (await runner().get(id, alice)).steps[0];
    expect(s.error).toContain('failed to set up step');
    expect(s.error).not.toContain('/var/lib/dagu');
    expect(s.error).toContain('<path>');
  });
  it('bounds everything: >64 nodes, >64 labels, hostile numbers, odd types, __proto__', async () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({ step: { name: `s${i}`, depends: Array.from({ length: 200 }, (_, k) => `d${k}`) }, status: 4, statusLabel: 'succeeded', startedAt: '2026-10-12T16:00:00Z', finishedAt: '2026-10-12T16:00:01Z' }));
    answer({ dagRunDetails: { name: 'fanout', dagRunId: 'r1', status: 4, statusLabel: 'succeeded', labels: [...ownLabels(), ...Array.from({ length: 500 }, (_, i) => `k${i}=v`), '__proto__=x', 'constructor=y'], params: 'a=1 __proto__=2', nodes } });
    const r = await runner().get('fanout.r1', alice, { detail: 'summary' });
    expect(r.steps).toHaveLength(64);
    expect(r.steps[0].depends_on.length).toBeLessThanOrEqual(64);
    expect(Object.keys(r.tags).length).toBeLessThanOrEqual(64);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r.tags, '__proto__')).toBe(false);
    expect(r.params).toEqual({ a: '1' });
  });
  it('unknown status numbers are "unknown", never "succeeded"; missing times are null, never 0', async () => {
    answer({ dagRunDetails: { name: 'fanout', dagRunId: 'r1', status: 99, statusLabel: 'x‮y', labels: ownLabels(), startedAt: 'yesterday', finishedAt: '', nodes: [{ step: { name: 'a' }, status: 'ok' }] } });
    const r = await runner().get('fanout.r1', alice, { detail: 'summary' });
    expect(r.state).toBe('unknown');
    expect(r.backend_state).toBe('xy');
    expect(r.started_at).toBeNull(); expect(r.ended_at).toBeNull();
    expect(r.steps[0]).toMatchObject({ state: 'unknown', exit_code: null, started_at: null });
  });
  it('rejects unreadable, oversized and slow answers with safe statuses', async () => {
    answer('<html>not json</html>');
    expect((await failure(runner().list({}, alice))).status).toBe(502);
    answer({ dagRuns: 'nope' });
    expect((await failure(runner().list({}, alice))).status).toBe(502);
    answer({ nothing: true });
    expect((await failure(runner().get('fanout.r1', alice))).status).toBe(502);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } })) as unknown as typeof fetch);
    expect((await failure(runner().list({}, alice))).message).toMatch(/too much data/);
    vi.stubGlobal('fetch', vi.fn(async (_u: string, i: RequestInit) => { const e = new Error('aborted'); e.name = 'AbortError'; void i; throw e; }) as unknown as typeof fetch);
    expect((await failure(runner().list({}, alice))).status).toBe(504);
  });
  it('a run list entry with a bad name or id is skipped; a cursor that is not printable is dropped', async () => {
    answer({ dagRuns: [{ name: '../x', dagRunId: 'a', labels: ownLabels(), status: 4 }, { name: 'ok', dagRunId: 'a b', labels: ownLabels(), status: 4 }, { name: 'ok', dagRunId: 'good', labels: ownLabels(), status: 4, statusLabel: 'succeeded' }], nextCursor: 'bad cursor\n' });
    const l = await runner().list({}, alice);
    expect(l.runs.map((r) => r.id)).toEqual(['ok.good']);
    expect(l.next_page_token).toBeNull();
  });
});

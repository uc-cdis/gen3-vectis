/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

const { authorizeJobs } = vi.hoisted(() => ({ authorizeJobs: vi.fn() }));
vi.mock('@/lib/jobs/portal', async (orig) => ({ ...(await orig<Record<string, unknown>>()), authorizeJobs }));
import handler from '@/pages/api/jobs/[...route]';
import catalogHandler from '@/pages/api/jobs/catalog';
import submitHandler from '@/pages/api/jobs/submit';
import { clearCatalogCache } from '../catalog/load';
import { createFakeDagu } from '@/lib/jobs/testing/fakeDagu';
import { DAG_FANOUT, ENTRY_FANOUT } from '../testing/definitions';

/** The portal's own API routes with JOBS_RUNNER=dagu: GitHub (catalog) and Dagu are both fakes; auth is mocked like in route.test.ts. */
const SHA = 'e'.repeat(40);
const TOKEN = 'dagu-service-token';
const ENTRY = ENTRY_FANOUT;
const NATIVE = DAG_FANOUT;
const CONTAINER = 'schema_version: 1\nid: boxed\nname: Boxed\nimage: alpine\ncommand: [echo, hi]\n';

type Opt = { method?: string; route?: string[]; body?: unknown; query?: Record<string, unknown> };
function call(o: Opt, h: (req: never, res: never) => Promise<unknown> = handler as never) {
  const req = { method: o.method ?? 'GET', query: { route: o.route ?? ['runs'], ...o.query }, body: o.body,
    headers: { host: 'portal.example.org', origin: 'https://portal.example.org', 'x-forwarded-proto': 'https', 'content-type': 'application/json', cookie: 'access_token=COOKIESECRET' } };
  const out: { status?: number; json?: unknown } = {};
  const res = { setHeader: () => undefined, status(n: number) { out.status = n; return this; }, json(b: unknown) { out.json = b; return this; } };
  return { out, run: () => h(req as never, res as never) };
}
let fake: ReturnType<typeof createFakeDagu>;
const as = (user: string) => authorizeJobs.mockResolvedValue({ ok: true, user, token: `bearer-of-${user}` });

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('JOBS_RUNNER', 'dagu');
  vi.stubEnv('DAGU_URL', 'http://dagu.test:8080');
  vi.stubEnv('DAGU_TOKEN', TOKEN);
  vi.stubEnv('JOBS_OWNER_HMAC_KEY', 'h'.repeat(40));
  vi.stubEnv('DAGU_ALLOWED_EXECUTORS', 'command');
  vi.stubEnv('TES_CATALOG_REPO', 'org/jobs');
  fake = createFakeDagu({ authorization: `Bearer ${TOKEN}` });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.host === 'api.github.com') {
      if (u.pathname.includes('/commits/')) return new Response(JSON.stringify({ sha: SHA }), { status: 200 });
      if (u.pathname.endsWith('/contents/jobs')) return new Response(JSON.stringify([{ name: 'dag-fanout.yaml', type: 'file', size: ENTRY.length }, { name: 'boxed.yaml', type: 'file', size: CONTAINER.length }]), { status: 200 });
      if (u.pathname.endsWith('/contents/jobs/dags/fanout.yaml')) return new Response(NATIVE, { status: 200 });
      if (u.pathname.endsWith('/contents/jobs/dag-fanout.yaml')) return new Response(ENTRY, { status: 200 });
      if (u.pathname.endsWith('/contents/jobs/boxed.yaml')) return new Response(CONTAINER, { status: 200 });
      return new Response('', { status: 404 });
    }
    return fake.fetch(url, init);
  }));
  clearCatalogCache();
  as('alice@example.org');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); authorizeJobs.mockReset(); });

describe('portal routes with JOBS_RUNNER=dagu', () => {
  it('the catalog lists the workflow with its graph and without the native text', async () => {
    const c = call({}, catalogHandler as never); await c.run();
    expect(c.out.status).toBe(200);
    const body = c.out.json as { jobs: Array<{ def: Record<string, unknown> }> };
    const wf = body.jobs.find((j) => j.def.id === 'dag-fanout')?.def;
    expect(wf).toMatchObject({ kind: 'dag', engine: 'dagu', graph: expect.arrayContaining([{ name: 'join', depends_on: ['branch_a', 'branch_b', 'branch_c'], executor: 'command' }]) });
    expect(JSON.stringify(body)).not.toContain('echo "branch');
  });
  it('submit -> list -> get -> cancel as the owner; the other user sees nothing and cannot cancel', async () => {
    const s = call({ method: 'POST', body: { job: 'dag-fanout', params: { label: 'rel_1' } } }, submitHandler as never); await s.run();
    expect(s.out.status).toBe(200);
    const { id } = s.out.json as { id: string };
    expect(id).toMatch(/^fanout\./);
    const sent = fake.calls.find((x) => x.method === 'POST')?.body as { spec: string; params: string; labels: string[] };
    expect(JSON.parse(JSON.stringify(parse(sent.spec)))).toEqual(JSON.parse(JSON.stringify(parse(NATIVE))));
    expect(JSON.parse(sent.params)).toEqual({ label: 'rel_1' });
    expect(sent.labels).toEqual(expect.arrayContaining(['vectis.job=dag-fanout', `vectis.catalog_sha=${SHA}`, 'vectis.catalog_repo=org/jobs']));
    expect(JSON.stringify(fake.calls)).not.toMatch(/bearer-of-alice|COOKIESECRET/);

    const l = call({ route: ['runs'] }); await l.run();
    expect((l.out.json as { runs: Array<{ id: string }> }).runs.map((r) => r.id)).toEqual([id]);
    const g = call({ route: ['runs', id] }); await g.run();
    expect(g.out.json).toMatchObject({ id, backend: 'dagu', state: 'running', params: { label: 'rel_1' } });

    as('bob@example.org');
    const bl = call({ route: ['runs'] }); await bl.run();
    expect((bl.out.json as { runs: unknown[] }).runs).toEqual([]);
    const bg = call({ route: ['runs', id] }); await bg.run();
    expect(bg.out.status).toBe(404);
    const bc = call({ method: 'POST', route: ['runs', `${id}:cancel`] }); await bc.run();
    expect(bc.out.status).toBe(404);
    expect(fake.runs[0].stopped).toBeUndefined();

    as('alice@example.org');
    const ac = call({ method: 'POST', route: ['runs', `${id}:cancel`] }); await ac.run();
    expect(ac.out.status).toBe(200);
    expect(fake.runs[0].stopped).toBe(true);
  });
  it('hostile params are a 400 and nothing reaches Dagu', async () => {
    for (const label of ['a;b', '$(id)', 'a b', '-x', '`id`']) {
      const s = call({ method: 'POST', body: { job: 'dag-fanout', params: { label } } }, submitHandler as never); await s.run();
      expect(s.out.status, label).toBe(400);
    }
    expect(fake.calls.filter((x) => x.method === 'POST')).toEqual([]);
  });
  it('a container job on the Dagu runner is refused (400) before anything is sent', async () => {
    const s = call({ method: 'POST', body: { job: 'boxed', params: {} } }, submitHandler as never); await s.run();
    expect(s.out.status).toBe(400);
    expect(fake.calls.filter((x) => x.method === 'POST')).toEqual([]);
  });
  it('the executor policy applies at catalog load: with the default allowlist the `command` workflow is reported, not served', async () => {
    vi.stubEnv('DAGU_ALLOWED_EXECUTORS', '');
    clearCatalogCache();
    const c = call({}, catalogHandler as never); await c.run();
    const body = c.out.json as { jobs: Array<{ def: { id: string } }>; errors: Array<{ file: string }> };
    expect(body.jobs.map((j) => j.def.id)).not.toContain('dag-fanout');
    expect(body.errors.map((e) => e.file)).toContain('dag-fanout.yaml');
    const s = call({ method: 'POST', body: { job: 'dag-fanout', params: {} } }, submitHandler as never); await s.run();
    expect(s.out.status).toBe(404);
  });
  it('unconfigured Dagu is a 503 on every run route, never a fallback to TES', async () => {
    vi.stubEnv('DAGU_URL', '');
    for (const r of [call({ route: ['runs'] }), call({ route: ['runs', 'fanout.abc'] }), call({ method: 'POST', route: ['runs', 'fanout.abc:cancel'] }), call({ route: ['service-info'] })]) { await r.run(); expect(r.out.status).toBe(503); }
  });
  it('there is still no raw create route and no storage setup', async () => {
    const c = call({ method: 'POST', route: ['runs'], body: { spec: 'x' } }); await c.run();
    expect(c.out.status).toBe(404);
    const st = call({ route: ['storage-setup'] }); await st.run();
    expect(st.out.status).toBe(404);
  });
});

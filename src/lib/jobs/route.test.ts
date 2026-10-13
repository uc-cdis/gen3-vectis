/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorize } from '@/lib/siem/bff';

const { authorizeJobs } = vi.hoisted(() => ({ authorizeJobs: vi.fn() }));
vi.mock('@/lib/jobs/portal', async (orig) => ({ ...(await orig<Record<string, unknown>>()), authorizeJobs }));
import handler from '@/pages/api/jobs/[...route]';
import catalogHandler from '@/pages/api/jobs/catalog';
import submitJob from '@/pages/api/jobs/submit';
import { isProduction } from '@/lib/jobs/portal';
import { matchJobsRoute, parseRunQuery } from '@/lib/jobs/routes';
import { prepareTask, imageAllowed, tesQuery, tesRunner, upstreamUrl } from '@/lib/jobs/tes/tesRunner';
import { clearCatalogCache } from '@/lib/jobs/catalog/load';

const TOKEN = 'tok-user';
type Opt = { method?: string; route?: string[]; query?: Record<string, unknown>; headers?: Record<string, string>; body?: unknown };
function call(o: Opt, h: (req: never, res: never) => Promise<unknown> = handler as never) {
  const req = { method: o.method ?? 'GET', query: { route: o.route ?? ['runs'], ...o.query }, body: o.body,
    headers: { host: 'portal.example.org', origin: 'https://portal.example.org', 'x-forwarded-proto': 'https', 'content-type': 'application/json', cookie: 'access_token=COOKIESECRET', ...o.headers } };
  const out: { status?: number; json?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = { setHeader: (k: string, v: string) => { out.headers[k] = v; }, status(n: number) { out.status = n; return this; }, json(b: unknown) { out.json = b; return this; } };
  return { out, run: () => h(req as never, res as never) };
}
const task = { executors: [{ image: 'registry.example.org/tools/tool:1', command: ['run'] }] };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('TES_SERVICE_URL', 'https://commons.example.org/ga4gh/tes');
  vi.stubEnv('TES_STORAGE_URL', 'https://commons.example.org/workflows');
  vi.stubEnv('TES_ALLOWED_IMAGE_PREFIXES', 'registry.example.org/tools/, python');
  authorizeJobs.mockResolvedValue({ ok: true, user: 'analyst1', token: TOKEN });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ tasks: [{ id: 't1', state: 'RUNNING' }] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  clearCatalogCache();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); authorizeJobs.mockReset(); });

describe('route allowlist', () => {
  it('allows exactly the Jobs routes', () => {
    expect(matchJobsRoute('GET', ['service-info'])).toEqual({ kind: 'service-info' });
    expect(matchJobsRoute('GET', ['storage-setup'])).toEqual({ kind: 'storage-setup' });
    expect(matchJobsRoute('GET', ['runs'])).toEqual({ kind: 'list' });
    expect(matchJobsRoute('GET', ['runs', 'abc-1.x'])).toEqual({ kind: 'get', id: 'abc-1.x' });
    expect(matchJobsRoute('POST', ['runs', 'abc-1:cancel'])).toEqual({ kind: 'cancel', id: 'abc-1' });
  });
  it('refuses bad task ids and odd colon forms', () => {
    for (const id of ['..', '.', 'a b', 'a%2Fb', 'a/b', 'a:b', 'a:cancel:cancel', ':cancel', 'x'.repeat(129) + ':cancel']) {
      expect(matchJobsRoute('POST', ['runs', id.endsWith(':cancel') ? id : `${id}:cancel`]), id).toBeNull();
      expect(matchJobsRoute('GET', ['runs', id]), id).toBeNull();
    }
    expect(matchJobsRoute('GET', ['runs', 'abc:cancel'])).toBeNull(); // cancel is POST only
    expect(matchJobsRoute('POST', ['runs', 'abc'])).toBeNull();
    expect(matchJobsRoute('DELETE', ['runs', 'abc'])).toBeNull();
    expect(matchJobsRoute('GET', ['runs', 'abc', 'x'])).toBeNull();
  });
  it('refuses the destructive and unrelated gen3-workflow endpoints', () => {
    for (const [m, r] of [['DELETE', ['storage', 'user-bucket']], ['DELETE', ['storage', 'user-bucket', 'objects']], ['DELETE', ['user-bucket']], ['GET', ['storage', 'setup']], ['GET', ['s3', 'x']], ['GET', ['ui']], ['GET', ['_status']], ['DELETE', ['storage-setup']], ['POST', ['storage-setup']], ['GET', ['storage', 'user-bucket']], ['POST', ['storage', 'user-bucket']], ['GET', ['tasks']], ['GET', ['tasks', 'abc']]] as const) {
      expect(matchJobsRoute(m, [...r]), `${m} ${r.join('/')}`).toBeNull();
    }
  });
  it('404s through the handler before any auth or upstream work', async () => {
    const c = call({ method: 'DELETE', route: ['storage', 'user-bucket'] }); await c.run();
    expect(c.out.status).toBe(404); expect(authorizeJobs).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('query validation', () => {
  const list = { kind: 'list' } as const;
  it('whitelists and validates, and the TES runner builds the same upstream query as before', () => {
    const r = parseRunQuery(list, { route: ['runs'], detail: 'full', state: 'queued', page_size: '10', tag_key: ['a', 'b'], tag_value: 'x', name_prefix: 'job', page_token: 'abc123' });
    expect(r).toEqual({ ok: true, query: { detail: 'full', state: 'queued', page_size: 10, page_token: 'abc123', name_prefix: 'job', tag_key: ['a', 'b'], tag_value: ['x'] } });
    expect(r.ok && tesQuery(r.query, 'summary')).toBe('?view=FULL&state=QUEUED&page_size=10&page_token=abc123&name_prefix=job&tag_key=a&tag_key=b&tag_value=x');
    expect(tesQuery({}, 'summary')).toBe('?view=BASIC');
    expect(tesQuery({ state: 'failed' }, 'summary')).toBe('?view=BASIC'); // several TES states: filtered after the fetch, not upstream
  });
  it('rejects bad values and unknown params', () => {
    for (const q of [{ detail: 'ALL' }, { view: 'FULL' }, { state: 'X' }, { state: 'RUNNING' }, { page_size: '0' }, { page_size: '513' }, { page_size: '1e3' }, { page_token: 'x'.repeat(513) }, { page_token: 'a b' }, { name_prefix: 'x'.repeat(129) }, { name_prefix: 'a\nb' }, { tag_key: Array(11).fill('a') }, { evil: '1' }, { detail: ['full', 'summary'] }]) {
      expect(parseRunQuery(list, q as never).ok, JSON.stringify(q)).toBe(false);
    }
    expect(parseRunQuery({ kind: 'get', id: 'a' }, { state: 'running' }).ok).toBe(false);
    expect(parseRunQuery({ kind: 'service-info' }, { detail: 'full' }).ok).toBe(false);
  });
});

describe('proxy', () => {
  it('forwards the user token only: no cookie, no client identity, no redirects', async () => {
    const c = call({ query: { detail: 'summary' }, headers: { authorization: 'Bearer forged', 'x-auth-request-user': 'admin' } }); await c.run();
    expect(c.out.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://commons.example.org/ga4gh/tes/tasks?view=BASIC');
    expect(init.headers).toEqual({ accept: 'application/json', authorization: `Bearer ${TOKEN}` });
    expect(JSON.stringify(init.headers)).not.toMatch(/COOKIESECRET|forged|admin/);
    expect(init.redirect).toBe('error');
    expect(c.out.headers['Cache-Control']).toBe('no-store');
    expect(c.out.json).toMatchObject({ runs: [{ id: 't1', backend: 'tes', state: 'running', backend_state: 'RUNNING' }], next_page_token: null });
  });
  it('uses read level for GET and submit level for POST/cancel', async () => {
    await call({}).run(); expect(authorizeJobs).toHaveBeenLastCalledWith(expect.any(String), 'read');
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await call({ method: 'POST', route: ['runs', 'abc:cancel'] }).run(); expect(authorizeJobs).toHaveBeenLastCalledWith(expect.any(String), 'submit');
    expect((fetchMock.mock.calls.at(-1) as [string])[0]).toBe('https://commons.example.org/ga4gh/tes/tasks/abc:cancel');
  });
  it('a user without /Jobs/submit can look but not run or cancel', async () => {
    authorizeJobs.mockImplementation(async (_c: string, level: string) => (level === 'submit' ? { ok: false, status: 403, error: 'You do not have access to this data.' } : { ok: true, user: 'u', token: TOKEN }));
    expect((await (async () => { const c = call({}); await c.run(); return c.out.status; })())).toBe(200);
    const p = call({ method: 'POST', body: { job: 'x' } }, submitJob as never); await p.run();
    const x = call({ method: 'POST', route: ['runs', 'abc:cancel'] }); await x.run();
    expect([p.out.status, x.out.status]).toEqual([403, 403]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('requires same-origin for cancel', async () => {
    const a = call({ method: 'POST', route: ['runs', 'a:cancel'], headers: { origin: 'https://evil.example.com' } }); await a.run();
    const c = call({ method: 'POST', route: ['runs', 'a:cancel'], headers: { 'sec-fetch-site': 'cross-site' } }); await c.run();
    expect([a.out.status, c.out.status]).toEqual([403, 403]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('there is no client route that creates a raw task (404 before auth)', async () => {
    for (const route of [['runs'], ['runs', 'x']]) {
      const c = call({ method: 'POST', route, body: task }); await c.run();
      expect(c.out.status).toBe(404);
    }
    expect(authorizeJobs).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('unauthenticated gets nothing and no upstream call', async () => {
    authorizeJobs.mockResolvedValue({ ok: false, status: 401, error: 'Sign in required.' });
    const c = call({}); await c.run(); expect(c.out.status).toBe(401); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('503 when TES_SERVICE_URL is unset or insecure', async () => {
    vi.stubEnv('TES_SERVICE_URL', ''); const a = call({}); await a.run();
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('TES_SERVICE_URL', 'http://tes.internal/x'); const b = call({}); await b.run();
    expect([a.out.status, b.out.status]).toEqual([503, 503]); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('hides upstream 5xx detail, shows a short sanitized 4xx message', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Traceback /srv/secret' }), { status: 500 }));
    const a = call({}); await a.run(); expect(a.out.status).toBe(502); expect(JSON.stringify(a.out.json)).not.toMatch(/srv|Traceback/);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: `bad‮${'x'.repeat(500)}` }), { status: 404 }));
    const b = call({ route: ['runs', 'nope'] }); await b.run();
    expect(b.out.status).toBe(404); const msg = (b.out.json as { error: string }).error; expect(msg.length).toBeLessThanOrEqual(200); expect(msg).not.toContain('‮');
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5'));
    const c = call({}); await c.run(); expect(JSON.stringify(c.out.json)).not.toContain('10.0.0.5');
  });
  it('sanitizes and caps log text coming back', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 't1', state: 'COMPLETE', executors: [{ image: 'i', command: ['c'] }], logs: [{ logs: [{ stdout: `a‮b\u001b${'z'.repeat(70000)}`, exit_code: 0 }] }] }), { status: 200 }));
    const c = call({ route: ['runs', 't1'], query: { detail: 'full' } }); await c.run();
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://commons.example.org/ga4gh/tes/tasks/t1?view=FULL');
    const l = (c.out.json as { steps: Array<{ stdout: string; truncated: boolean }> }).steps[0];
    expect(l.stdout.length).toBe(65536); expect(l.truncated).toBe(true); expect(l.stdout).not.toMatch(/[\p{Cc}‮]/u);
  });
  it('storage-setup is read-only and normalised', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ bucket: 'ub-1', region: 'us-east-1', secret_key: 'a b' }), { status: 200 }));
    const c = call({ route: ['storage-setup'] }); await c.run();
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://commons.example.org/workflows/storage/setup');
    expect(c.out.json).toEqual({ bucket: 'ub-1', region: 'us-east-1', endpoint: null }); // nothing else is exposed
  });
});

describe('task submission policy (prepareTask)', () => {
  const E = { TES_ALLOWED_IMAGE_PREFIXES: 'registry.example.org/tools/, python', NODE_ENV: 'test' };
  const t = (image: string) => ({ executors: [{ image, command: ['a'] }] });
  it('strips non-catalog vectis.* tags and adds the verified submitter', () => {
    const r = prepareTask({ ...task, tags: { 'vectis.submitted_by': 'admin', 'Vectis.job': 'x', 'vectis.catalog_sha': 'f', 'vectis.other': 'x', team: 'a' } }, 'analyst1', { env: E });
    expect(r).toMatchObject({ ok: true, task: { tags: { team: 'a', 'vectis.catalog_sha': 'f', 'vectis.submitted_by': 'analyst1' } } });
    expect(JSON.stringify(r)).not.toMatch(/admin|vectis\.other|Vectis/);
    expect(prepareTask(task, 'u\u202E', { env: E })).toMatchObject({ ok: true, task: { tags: { 'vectis.submitted_by': 'u?' } } });
  });
  it('drops server-owned fields instead of forwarding them', () => {
    const r = prepareTask({ ...task, id: 'forged', state: 'COMPLETE', logs: [], creation_time: 'x' }, 'u', { env: E });
    expect(r.ok && Object.keys(r.task).sort()).toEqual(['executors', 'tags']);
  });
  it('refuses a disallowed image, including prefix tricks', () => {
    for (const image of ['evil.io/x', 'registry.example.org/tools-evil/x', 'registry.example.org/tools/../../evil/x', 'python-evil:1', 'pythonx', 'python@sha256:' + 'a'.repeat(64)]) expect(prepareTask(t(image), 'u', { env: E }).ok, image).toBe(false);
    for (const image of ['python:3.9-slim', 'python', 'registry.example.org/tools/tool:1']) expect(prepareTask(t(image), 'u', { env: E }).ok, image).toBe(true);
  });
  it('an exact-repository entry does not match a registry port or digest form', () => {
    const env = { TES_ALLOWED_IMAGE_PREFIXES: 'registry.example.com', NODE_ENV: 'test' };
    for (const image of ['registry.example.com:5000/x', 'registry.example.com@sha256:' + 'a'.repeat(64), 'registry.example.com:5000/x:1']) expect(imageAllowed(image, env), image).toBe(false);
    expect(imageAllowed('registry.example.com:1.0', env)).toBe(true);
  });
  it('digest pinning can be required', () => {
    const env = { TES_ALLOWED_IMAGE_PREFIXES: 'registry.example.org/tools/', TES_REQUIRE_IMAGE_DIGEST: 'true', NODE_ENV: 'test' };
    expect(imageAllowed('registry.example.org/tools/x:1', env)).toBe(false);
    expect(imageAllowed('registry.example.org/tools/x@sha256:' + 'b'.repeat(64), env)).toBe(true);
  });
  it('production is the default; any-image needs the second acknowledgement', () => {
    for (const NODE_ENV of [undefined, '', 'staging', 'production']) {
      expect(imageAllowed('x/y', { NODE_ENV }), String(NODE_ENV)).toBe('not-configured');
      expect(imageAllowed('x/y', { NODE_ENV, TES_ALLOW_ANY_IMAGE: 'true' }), String(NODE_ENV)).toBe('not-configured');
    }
    expect(imageAllowed('x/y', { NODE_ENV: 'production', TES_ALLOW_ANY_IMAGE: 'true', TES_I_UNDERSTAND_ANY_IMAGE_IS_UNSAFE: 'yes' })).toBe(true);
    expect(imageAllowed('x/y', { NODE_ENV: 'development' })).toBe(true);
    expect(isProduction({})).toBe(true); expect(isProduction({ NODE_ENV: 'test' })).toBe(false);
  });
  it('an unset or odd NODE_ENV requires an https upstream', () => {
    for (const NODE_ENV of [undefined, 'staging']) expect(upstreamUrl({ kind: 'service-info' }, '', { NODE_ENV, TES_SERVICE_URL: 'http://tes.example.org' })).toBeNull();
    expect(upstreamUrl({ kind: 'service-info' }, '', { NODE_ENV: 'test', TES_SERVICE_URL: 'http://tes.example.org' })).toBe('http://tes.example.org/service-info');
  });
  it('refuses credentials, and secret:// names that the definition did not declare', () => {
    const withEnv = (env: Record<string, string>) => ({ executors: [{ image: 'python:3', command: ['a'], env }] });
    for (const env of [{ AWS_KEY: 'AKIAIOSFODNN7EXAMPLE' }, { SECRET_TOKEN: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }, { P: 'secret://db' }] as Array<Record<string, string>>) {
      const r = prepareTask(withEnv(env), 'u', { env: E });
      expect(r.ok, JSON.stringify(env)).toBe(false);
      expect(JSON.stringify(r)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    }
    expect(prepareTask(withEnv({ P: 'secret://db' }), 'u', { env: E, declaredSecrets: new Set(['db']) }).ok).toBe(true);
    expect(prepareTask(withEnv({ P: 'secret://other' }), 'u', { env: E, declaredSecrets: new Set(['db']) }).ok).toBe(false);
  });
  it('the verified email is preferred over a display name', async () => {
    const deps = { loginStatus: async () => ({ status: 'issued', userContext: { name: 'Ann Smith', email: 'ann@example.org', username: 'ann1' } }), accessToken: () => 't', resources: async () => ['/p/jobs'], routeConfig: async () => ({ routes: { '/Jobs': { authz: ['/p/jobs'] } } }), production: true } as never;
    expect(await authorize('c', deps, '/Jobs', ['email', 'username', 'name'])).toMatchObject({ ok: true, user: 'ann@example.org' });
    expect(await authorize('c', deps, '/Jobs')).toMatchObject({ ok: true, user: 'Ann Smith' }); // console order unchanged
  });
});

describe('authorize (real logic) for the Jobs keys', () => {
  const deps = (granted: string[], routes: Record<string, unknown>) => ({
    loginStatus: vi.fn(async () => ({ status: 'issued', userContext: { name: 'Ann' } })),
    accessToken: vi.fn(() => 'tok'),
    resources: vi.fn(async () => granted),
    routeConfig: vi.fn(async () => ({ routes })),
    production: true,
  }) as never;
  const routes = { '/Jobs': { authz: ['/p/jobs'] }, '/Jobs/submit': { authz: ['/p/jobs-run'] } };
  it('read-only user: /Jobs yes, /Jobs/submit no', async () => {
    const d = deps(['/p/jobs'], routes);
    expect((await authorize('c', d, '/Jobs')).ok).toBe(true);
    expect(await authorize('c', d, '/Jobs/submit')).toMatchObject({ ok: false, status: 403 });
  });
  it('missing, empty or unreadable authz config denies', async () => {
    expect(await authorize('c', deps(['/p/jobs'], {}), '/Jobs')).toMatchObject({ ok: false, status: 403 });
    expect(await authorize('c', deps(['/p/jobs'], { '/Jobs': { authz: [] } }), '/Jobs')).toMatchObject({ ok: false, status: 403 });
    const d = deps(['/p/jobs'], routes); (d as { routeConfig: unknown }).routeConfig = vi.fn(async () => { throw new Error('x'); });
    expect(await authorize('c', d, '/Jobs')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('catalog + submit-job endpoints', () => {
  const GOOD = 'schema_version: 1\nid: good\nname: Good\nimage: registry.example.org/tools/tool:1\ncommand: [run, "{{n}}"]\nparams:\n  - {name: n, label: N, type: integer, default: 3}\noutputs:\n  - {name: o, url: "s3://{{user_bucket}}/out/", path: /o}\n';
  const SHA = 'c'.repeat(40);
  const ghFetch = () => async (url: string) => {
    const u = new URL(url);
    if (u.host === 'api.github.com') {
      if (u.pathname.includes('/commits/')) return new Response(JSON.stringify({ sha: SHA }), { status: 200 });
      if (u.pathname.endsWith('/contents/jobs')) return new Response(JSON.stringify([{ name: 'good.yaml', type: 'file', size: GOOD.length }]), { status: 200 });
      return new Response(GOOD, { status: 200 });
    }
    if (u.pathname.endsWith('/storage/setup')) return new Response('{"bucket":"user-bkt"}', { status: 200 });
    return new Response('{"id":"new-1"}', { status: 200 });
  };
  beforeEach(() => { vi.stubEnv('TES_CATALOG_REPO', 'org/jobs'); vi.stubEnv('TES_CATALOG_GITHUB_TOKEN', 'ghp_TOPSECRETTOKENVALUE0123456789abcdefgh'); fetchMock.mockImplementation(ghFetch()); });

  it('catalog needs /Jobs and never leaks the token', async () => {
    const c = call({}, catalogHandler as never); await c.run();
    expect(c.out.status).toBe(200); expect(authorizeJobs).toHaveBeenLastCalledWith(expect.any(String), 'read');
    expect(c.out.json).toMatchObject({ configured: true, sha: SHA, jobs: [{ file: 'good.yaml' }] });
    expect(JSON.stringify(c.out)).not.toContain('TOPSECRET');
  });
  it('catalog denies unauthenticated and misconfigured', async () => {
    authorizeJobs.mockResolvedValueOnce({ ok: false, status: 403, error: 'no' });
    const a = call({}, catalogHandler as never); await a.run(); expect(a.out.status).toBe(403);
    vi.stubEnv('TES_CATALOG_PATH', '../x');
    const b = call({}, catalogHandler as never); await b.run(); expect(b.out.status).toBe(502); expect(JSON.stringify(b.out.json)).not.toContain('TOPSECRET');
  });
  it('catalog reports configured:false when unset', async () => {
    vi.stubEnv('TES_CATALOG_REPO', '');
    const c = call({}, catalogHandler as never); await c.run();
    expect(c.out.json).toMatchObject({ configured: false, jobs: [] });
  });
  it('submit-job compiles server-side, fills user_bucket from storage setup, tags provenance', async () => {
    const c = call({ method: 'POST', body: { job: 'good', params: { n: 7 } } }, submitJob as never); await c.run();
    expect(c.out.status).toBe(200); expect(authorizeJobs).toHaveBeenLastCalledWith(expect.any(String), 'submit');
    const post = (fetchMock.mock.calls as Array<[string, RequestInit]>).find(([u, i]) => u.endsWith('/tasks') && i.method === 'POST')!;
    const sent = JSON.parse(post[1].body as string);
    expect(sent.executors[0].command).toEqual(['run', '7']);
    expect(sent.outputs[0].url).toBe('s3://user-bkt/out/');
    expect(sent.tags).toEqual({ 'vectis.job': 'good', 'vectis.catalog_sha': SHA, 'vectis.catalog_repo': 'org/jobs', 'vectis.submitted_by': 'analyst1' });
  });
  it('submit-job refuses bad params, unknown jobs, cross-site and read-only users', async () => {
    const bad = call({ method: 'POST', body: { job: 'good', params: { n: 'x' } } }, submitJob as never); await bad.run();
    const unk = call({ method: 'POST', body: { job: 'nope' } }, submitJob as never); await unk.run();
    const xs = call({ method: 'POST', body: { job: 'good' }, headers: { origin: 'https://evil.example.com' } }, submitJob as never); await xs.run();
    authorizeJobs.mockResolvedValueOnce({ ok: false, status: 403, error: 'no' });
    const ro = call({ method: 'POST', body: { job: 'good' } }, submitJob as never); await ro.run();
    expect([bad.out.status, unk.out.status, xs.out.status, ro.out.status]).toEqual([400, 404, 403, 403]);
  });
});

describe('runner selection (JOBS_RUNNER)', () => {
  it('defaults to TES and treats an empty value as unset', async () => {
    vi.stubEnv('JOBS_RUNNER', '');
    const c = call({}); await c.run(); expect(c.out.status).toBe(200);
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/ga4gh/tes/tasks');
  });
  it('an unknown value fails closed everywhere, before any upstream call, without echoing the value', async () => {
    for (const v of ['Batch', 'tes ; batch', 'k8s', 'TES']) {
      vi.stubEnv('JOBS_RUNNER', v);
      const list = call({}); await list.run();
      const cat = call({}, catalogHandler as never); await cat.run();
      const sub = call({ method: 'POST', body: { job: 'x' } }, submitJob as never); await sub.run();
      expect([list.out.status, cat.out.status, sub.out.status], v).toEqual([500, 500, 500]);
      expect(JSON.stringify([list.out.json, cat.out.json, sub.out.json])).not.toContain(v);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('JOBS_RUNNER=batch is not a runner: 500 "unknown runner", never a fallback to TES', async () => {
    vi.stubEnv('JOBS_RUNNER', 'batch');
    const list = call({}); await list.run();
    const cancel = call({ method: 'POST', route: ['runs', 'abc:cancel'] }); await cancel.run();
    expect([list.out.status, cancel.out.status]).toEqual([500, 500]);
    expect((list.out.json as { error: string }).error).toMatch(/unknown runner/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a job that needs {{user_bucket}} is refused with a clear message when the runner offers no storage', async () => {
    vi.stubEnv('TES_CATALOG_REPO', 'org/jobs');
    const NEEDS = 'schema_version: 1\nid: needs\nname: Needs\nimage: python:3\ncommand: [run]\noutputs:\n  - {name: o, url: "s3://{{user_bucket}}/o/", path: /o}\n';
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.includes('/commits/')) return new Response(JSON.stringify({ sha: 'c'.repeat(40) }), { status: 200 });
      if (u.pathname.endsWith('/contents/jobs')) return new Response(JSON.stringify([{ name: 'n.yaml', type: 'file', size: NEEDS.length }]), { status: 200 });
      return new Response(NEEDS, { status: 200 });
    });
    const saved = tesRunner.storageSetup;
    (tesRunner as { storageSetup?: unknown }).storageSetup = undefined;
    try {
      const c = call({ method: 'POST', body: { job: 'needs' } }, submitJob as never); await c.run();
      const st = call({ route: ['storage-setup'] }); await st.run();
      expect([c.out.status, st.out.status]).toEqual([400, 404]);
      expect((c.out.json as { error: string }).error).toMatch(/personal storage bucket.*does not provide/);
    } finally { tesRunner.storageSetup = saved; }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('@/lib/siem/bff', async (orig) => ({ ...(await orig<Record<string, unknown>>()), authorize }));
// the real handler lives in [...route].ts
import handler from '@/pages/api/siem/[...route]';

function call(over: { method?: string; route?: unknown; headers?: Record<string, string>; body?: unknown }) {
  const req = { method: over.method ?? 'POST', query: { route: over.route ?? ['overview'] }, body: over.body ?? { x: 1 },
    headers: { host: 'portal.example.org', origin: 'https://portal.example.org', 'x-forwarded-proto': 'https', 'content-type': 'application/json', cookie: 'access_token=SECRET', ...over.headers } };
  const out: { status?: number; json?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = { setHeader: (k: string, v: string) => { out.headers[k] = v; }, status(n: number) { out.status = n; return this; }, json(b: unknown) { out.json = b; return this; } };
  return { req, res, out, run: () => handler(req as never, res as never) };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  authorize.mockResolvedValue({ ok: true, user: 'analyst1', token: 'tok' });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); authorize.mockReset(); });

describe('/api/siem proxy', () => {
  it('forwards an allowed call with verified identity and no cookie', async () => {
    const c = call({ headers: { 'x-auth-request-user': 'admin', remote_user: 'admin', authorization: 'Bearer forged' } });
    await c.run();
    expect(c.out.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/siem\/overview$/);
    expect(init.headers).toMatchObject({ 'x-auth-request-user': 'analyst1', authorization: 'Bearer tok' });
    expect(JSON.stringify(init.headers)).not.toMatch(/SECRET|forged|"admin"/);
    expect(c.out.headers['Cache-Control']).toBe('no-store');
  });
  it('never calls upstream when not authorised', async () => {
    authorize.mockResolvedValue({ ok: false, status: 401, error: 'Sign in required.' });
    const c = call({}); await c.run();
    expect(c.out.status).toBe(401); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('404 for a route that is not in the table, before any auth work', async () => {
    const c = call({ route: ['admin', 'purge'] }); await c.run();
    expect(c.out.status).toBe(404); expect(authorize).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('404 for traversal-shaped paths', async () => {
    for (const route of [['..', 'etc'], ['alerts', '../x'], ['alerts', 'a%2fb']]) { const c = call({ route }); await c.run(); expect(c.out.status).toBe(404); }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses cross-site writes and non-JSON bodies', async () => {
    const a = call({ headers: { origin: 'https://evil.example.com' } }); await a.run(); expect(a.out.status).toBe(403);
    const b = call({ headers: { 'content-type': 'text/plain' } }); await b.run(); expect(b.out.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('hides upstream 5xx detail', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Traceback /srv/secret' }), { status: 500 }));
    const c = call({}); await c.run();
    expect(c.out.status).toBe(502); expect(JSON.stringify(c.out.json)).not.toMatch(/srv|Traceback/);
  });
  it('reports an unreachable service without internals', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8000'));
    const c = call({}); await c.run();
    expect(c.out.status).toBe(502); expect(JSON.stringify(c.out.json)).not.toMatch(/10\.0\.0\.5/);
  });
  it('does not follow upstream redirects with the user identity attached', async () => {
    const c = call({}); await c.run();
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].redirect).toBe('error');
  });
  it('refuses a write whose Origin uses a different scheme than the request', async () => {
    const c = call({ headers: { origin: 'http://portal.example.org' } }); await c.run();
    expect(c.out.status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses a write the browser marks as cross-site, even with a matching Origin', async () => {
    const c = call({ headers: { 'sec-fetch-site': 'cross-site' } }); await c.run();
    expect(c.out.status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('accepts a same-origin write that the browser marks same-origin', async () => {
    const c = call({ headers: { 'sec-fetch-site': 'same-origin' } }); await c.run();
    expect(c.out.status).toBe(200);
  });
  it('allows GET without an Origin header', async () => {
    const c = call({ method: 'GET', route: ['catalog'], headers: { origin: '' } }); await c.run();
    expect(c.out.status).toBe(200);
  });
});

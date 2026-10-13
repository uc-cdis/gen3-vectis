import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthDeps} from './bff';
import { authorize, publicError, sameOrigin, upstreamHeaders, validSegments } from './bff';

const deps = (over: Partial<{ status: string; token: string | undefined; authz: string[] | undefined; granted: string[]; ctx: Record<string, unknown> }> = {}): AuthDeps => {
  const o = { status: 'issued', token: 'tok', authz: ['/programs/vectis/projects/siem'], granted: ['/programs/vectis/projects/siem'], ctx: { name: 'analyst1' }, ...over };
  return {
    loginStatus: (async () => ({ status: o.status, userContext: o.ctx })) as unknown as AuthDeps['loginStatus'],
    accessToken: (() => o.token) as unknown as AuthDeps['accessToken'],
    resources: (async () => o.granted) as unknown as AuthDeps['resources'],
    routeConfig: (async () => ({ routes: { '/Security': o.authz === undefined ? {} : { authz: o.authz } } })) as unknown as AuthDeps['routeConfig'],
    production: false,
  };
};

describe('authorize', () => {
  it('allows a signed-in user with the resource', async () => {
    expect(await authorize('c', deps())).toEqual({ ok: true, user: 'analyst1', token: 'tok' });
  });
  it.each(['expired', 'invalid', 'not present'])('401 when login status is %s', async (status) => {
    expect(await authorize('c', deps({ status }))).toMatchObject({ ok: false, status: 401 });
  });
  it('401 when there is no token', async () => {
    expect(await authorize('c', deps({ token: undefined }))).toMatchObject({ ok: false, status: 401 });
  });
  it('403 when the user lacks the resource', async () => {
    expect(await authorize('c', deps({ granted: ['/other'] }))).toMatchObject({ ok: false, status: 403 });
  });
  it('FAILS CLOSED when the route has no authz configured', async () => {
    expect(await authorize('c', deps({ authz: [] }))).toMatchObject({ ok: false, status: 403 });
    expect(await authorize('c', deps({ authz: undefined }))).toMatchObject({ ok: false, status: 403 });
  });
  it('FAILS CLOSED when the config cannot be loaded', async () => {
    const d = deps();
    d.routeConfig = (async () => { throw new Error('boom'); }) as unknown as AuthDeps['routeConfig'];
    expect(await authorize('c', d)).toMatchObject({ ok: false, status: 403 });
  });
  it('rejects a user name that cannot be sent as a plain header value', async () => {
    for (const name of ['bób€', 'tab\there', ' lead', 'trail ', 'a\r\nx-evil: 1', '日本語']) {
      expect(await authorize('c', deps({ ctx: { name } }))).toMatchObject({ ok: false, status: 401 });
    }
    expect(await authorize('c', deps({ ctx: { name: 'Ana Maria Lopez' } }))).toMatchObject({ ok: true });
  });
  it('asks for permissions with a short cache lifetime so a revocation does not linger', async () => {
    const seen: unknown[][] = [];
    const d = deps(); d.resources = (async (...a: unknown[]) => { seen.push(a); return ['/programs/vectis/projects/siem']; }) as unknown as AuthDeps['resources'];
    await authorize('c', d);
    expect(seen[0]![2]).toBe(30);
  });
  it('401 when the token carries no usable user name', async () => {
    expect(await authorize('c', deps({ ctx: {} }))).toMatchObject({ ok: false, status: 401 });
    expect(await authorize('c', deps({ ctx: { name: 'bad\nname' } }))).toMatchObject({ ok: false, status: 401 });
  });
});

describe('validSegments', () => {
  it('accepts normal paths', () => expect(validSegments(['alerts', 'g-1', 'why'])).toEqual(['alerts', 'g-1', 'why']));
  it.each([undefined, [], 'alerts', ['..'], ['.'], ['a/b'], ['a b'], ['a%2fb'], ['a\nb'], [''], ['x'.repeat(129)], ['a', 'b', 'c', 'd', 'e']])(
    'rejects %j', (raw) => expect(validSegments(raw as never)).toBeNull());
});

describe('sameOrigin', () => {
  it('lets GET through and requires a matching Origin for writes', () => {
    expect(sameOrigin('GET', undefined, 'portal.example.org')).toBe(true);
    expect(sameOrigin('POST', 'https://portal.example.org', 'portal.example.org')).toBe(true);
    expect(sameOrigin('POST', 'https://evil.example.com', 'portal.example.org')).toBe(false);
    expect(sameOrigin('POST', undefined, 'portal.example.org')).toBe(false);
    expect(sameOrigin('PATCH', 'not a url', 'portal.example.org')).toBe(false);
  });
  it('requires the same scheme and port, and no cross-site fetch', () => {
    expect(sameOrigin('POST', 'http://portal.example.org', 'portal.example.org', 'https')).toBe(false);
    expect(sameOrigin('POST', 'https://portal.example.org:8443', 'portal.example.org', 'https')).toBe(false);
    expect(sameOrigin('POST', 'https://portal.example.org:8443', 'portal.example.org:8443', 'https')).toBe(true);
    expect(sameOrigin('POST', 'https://portal.example.org', 'portal.example.org', 'https', 'cross-site')).toBe(false);
    expect(sameOrigin('POST', 'https://portal.example.org', 'portal.example.org', 'https', 'same-site')).toBe(false);
    expect(sameOrigin('POST', 'https://portal.example.org', 'portal.example.org', 'https', 'same-origin')).toBe(true);
  });
});

describe('upstream request', () => {
  it('is built from verified identity only', () => {
    const h = upstreamHeaders({ user: 'analyst1', token: 'tok' }, true);
    expect(h).toEqual({ accept: 'application/json', authorization: 'Bearer tok', 'x-auth-request-user': 'analyst1', 'content-type': 'application/json' });
    expect(Object.keys(h)).not.toContain('cookie');
  });
  it('turns upstream 5xx into a generic message and keeps short 4xx messages', () => {
    expect(publicError(500, { error: 'Traceback: secret path /srv/x' })).toEqual({ status: 502, body: { error: 'The security service returned an error.' } });
    expect(publicError(412, { error: 'etag mismatch' })).toEqual({ status: 412, body: { error: 'etag mismatch' } });
    expect(publicError(422, { detail: 'x'.repeat(1000) }).body.error).toHaveLength(300);
    expect(publicError(404, null).body.error).toBe('Request failed (404).');
  });
});

afterEach(() => vi.restoreAllMocks());

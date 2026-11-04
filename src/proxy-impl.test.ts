import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const routes: Record<string, unknown> = {};
vi.mock('./lib/auth/arboristConfig', () => ({ getRouteConfig: async () => ({ routes }) }));
const login = vi.fn(async (_cookie: string) => ({ status: 'not present' }));
vi.mock('./lib/auth/getLoginStatus', () => ({ getLoginStatus: (c: string) => login(c) }));
vi.mock('./lib/auth/fetchAuthz', () => ({ fetchArboristResources: async () => [] }));
vi.mock('@gen3/frontend/server', () => ({ getAccessToken: () => undefined }));

import { isDevPageWithoutLogin, proxy } from './proxy-impl';

const req = (path: string) => new NextRequest(`https://portal.example${path}`);

describe('page proxy', () => {
  beforeEach(() => { for (const k of Object.keys(routes)) delete routes[k]; login.mockClear(); });

  it('sends a page with no rule at all to the login page', async () => {
    const res = await proxy(req('/Explorer'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/Login?referer=%2FExplorer');
  });

  it('lets a page through only when its rule says loginRequired false', async () => {
    routes['/'] = { loginRequired: false };
    const res = await proxy(req('/'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(login).not.toHaveBeenCalled();
  });

  it('uses the * rule for a page that is not listed', async () => {
    routes['*'] = { loginRequired: true };
    expect((await proxy(req('/Discovery'))).status).toBe(307);
  });

  it('replies 403, not 200, when a logged-in user lacks the required authz resource', async () => {
    login.mockResolvedValueOnce({ status: 'issued' });
    routes['/Security'] = { loginRequired: true, authz: ['/programs/vectis/projects/siem'] };
    const res = await proxy(req('/Security'));
    // A status-less rewrite would silently reply 200, hiding the denial from WAFs, uptime checks and 403-based alerting.
    expect(res.status).toBe(403);
  });
});


describe('the development pages', () => {
  it('skip the login only when the flag is on, outside a production build, for a path under /dev/', () => {
    const on = { NODE_ENV: 'development', DEV_PAGES_NO_LOGIN: '1' };
    expect(isDevPageWithoutLogin('/dev/security', on)).toBe(true);
    expect(isDevPageWithoutLogin('/dev/jobs', { ...on, NODE_ENV: 'test' })).toBe(true);
    expect(isDevPageWithoutLogin('/dev/security', { NODE_ENV: 'development' })).toBe(false);
    expect(isDevPageWithoutLogin('/dev/security', { ...on, DEV_PAGES_NO_LOGIN: 'true' })).toBe(false);
    expect(isDevPageWithoutLogin('/Security', on)).toBe(false);
    expect(isDevPageWithoutLogin('/development', on)).toBe(false);
    expect(isDevPageWithoutLogin('/dev', on)).toBe(false);
  });

  it('never skip the login in a production build, whatever the flag says', () => {
    expect(isDevPageWithoutLogin('/dev/security', { NODE_ENV: 'production', DEV_PAGES_NO_LOGIN: '1' })).toBe(false);
  });

  it('still send a /dev page to the login page when the flag is not set', async () => {
    const res = await proxy(req('/dev/security?tab=hunt'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/Login?');
    expect(location).toContain('referer=%2Fdev%2Fsecurity');
  });
});

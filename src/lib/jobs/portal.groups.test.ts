import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authorize = vi.fn();
const getRouteConfig = vi.fn();

vi.mock('@/lib/siem/bff', () => ({
  authorize: (...a: unknown[]) => authorize(...a),
  isProduction: () => false, requestProto: () => 'https', sameOrigin: () => true, writeAllowed: () => true,
  MAX_RESPONSE_BYTES: 1, UPSTREAM_TIMEOUT_MS: 1,
}));
vi.mock('@/lib/auth/arboristConfig', () => ({ getRouteConfig: () => getRouteConfig() }));

import { allowedJobGroups } from './portal';

const COOKIE = 'fence_access_token=SECRET-TOKEN-VALUE';
const routes = (names: string[]) => ({ routes: { '/Jobs': {}, '/Jobs/profile/notebook': {}, ...Object.fromEntries(names.map((n) => [`/Jobs/group/${n}`, {}])) } });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  authorize.mockReset();
  getRouteConfig.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());      // a spy kept across tests would carry the earlier tests' calls into the next one

describe('allowedJobGroups', () => {
  it('offers the groups the person is a member of, and only those, in order', async () => {
    getRouteConfig.mockResolvedValue(routes(['soc', 'platform', 'ops']));
    authorize.mockImplementation(async (_c: unknown, _r: unknown, key: string) => ({ ok: key !== '/Jobs/group/ops' }));
    expect(await allowedJobGroups(COOKIE)).toEqual(['platform', 'soc']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('says why the list is empty when a group is configured but the person is not a member, without logging who they are', async () => {
    getRouteConfig.mockResolvedValue(routes(['soc']));
    authorize.mockResolvedValue({ ok: false, status: 403, error: 'nope', user: 'alice@example.org' });
    expect(await allowedJobGroups(COOKIE)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('1 configured in authz.json, 0 allowed');
    expect(line).toContain('soc=no:403');
    expect(line).not.toMatch(/SECRET-TOKEN-VALUE|alice|jobs-group-soc/);
  });

  it('says so when no group is configured in this build', async () => {
    getRouteConfig.mockResolvedValue(routes([]));
    expect(await allowedJobGroups(COOKIE)).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain('0 configured in authz.json, 0 allowed');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('says so when the route configuration cannot be read, and still offers none', async () => {
    getRouteConfig.mockRejectedValue(new Error('config missing'));
    expect(await allowedJobGroups(COOKIE)).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain('route configuration could not be read');
  });

  it('ignores group names that are not plain lower-case words and caps the list', async () => {
    getRouteConfig.mockResolvedValue(routes(['Bad Name', 'x'.repeat(40), '1abc', ...Array.from({ length: 12 }, (_, i) => `g${String.fromCharCode(97 + i)}`)]));
    authorize.mockResolvedValue({ ok: true });
    const got = await allowedJobGroups(COOKIE);
    expect(got).toHaveLength(8);
    expect(got.every((n) => /^[a-z][a-z0-9-]{0,31}$/.test(n))).toBe(true);
  });
});

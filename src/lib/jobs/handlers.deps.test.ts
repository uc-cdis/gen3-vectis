/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it, vi } from 'vitest';
import { handleCatalog, handleRuns, handleSubmit, realDeps } from './handlers';
import type { JobsDeps } from './handlers';

// The seam: handlers take optional dependencies and DEFAULT to the real ones (login + Arborist). Nothing in the environment swaps them.
const res = () => {
  const out: { status?: number; json?: unknown } = {};
  const r = { setHeader: () => undefined, status(n: number) { out.status = n; return this; }, json(b: unknown) { out.json = b; return this; } };
  return { out, r: r as never };
};
const req = (o: Record<string, unknown>) => ({ method: 'GET', query: { route: ['runs'] }, headers: { cookie: 'x=1' }, ...o }) as never;

describe('handler dependency seam', () => {
  it('with no dependencies the real gate runs: no login cookie means 401, whatever the environment says', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('JOBS_RUNNER', 'dagu'); vi.stubEnv('JOBS_DEV_IDENTITY', 'dev-user@example.org');
    for (const h of [handleRuns, handleCatalog]) {
      const { out, r } = res();
      await h(req({ headers: {} }), r);
      expect(out.status, h.name).toBe(401);
    }
    vi.unstubAllEnvs();
  });
  it('an injected authorizer decides who is calling; a denial stops the request before the runner', async () => {
    const runner = { list: vi.fn(), id: 'x' };
    const deps: JobsDeps = { ...realDeps(), authorize: async () => ({ ok: false, status: 403, error: 'no' }), getRunner: () => runner as never };
    const { out, r } = res();
    await handleRuns(req({}), r, deps);
    expect(out.status).toBe(403);
    expect(runner.list).not.toHaveBeenCalled();
  });
  it('the injected identity reaches the runner as ctx.user; the browser cannot supply one', async () => {
    const list = vi.fn(async () => ({ runs: [], next_page_token: null }));
    const deps: JobsDeps = { ...realDeps(), authorize: async () => ({ ok: true, user: 'dev@example.org', token: 't' }), getRunner: () => ({ list } as never), writeAllowed: () => true };
    const { out, r } = res();
    await handleRuns(req({ headers: { 'x-auth-request-user': 'root@example.org', cookie: '' } }), r, deps);
    expect(out.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.anything(), { user: 'dev@example.org', token: 't' });
  });
  it('submit refuses a cross-site write before authorization or the catalog is touched', async () => {
    const authorize = vi.fn();
    const deps: JobsDeps = { ...realDeps(), authorize, writeAllowed: () => false };
    const { out, r } = res();
    await handleSubmit(req({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { job: 'x' } }), r, deps);
    expect(out.status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
  });
});

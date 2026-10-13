import { describe, expect, it, vi } from 'vitest';
import { JobsApiError, createLiveApi } from './client';
import { FIXTURE_REPO, createFixtureApi } from './fixtureApi';

describe('fixture catalog', () => {
  it('parses every definition and reports one broken file', async () => {
    const c = await createFixtureApi({ delayMs: 0 }).catalog();
    expect(c.jobs.map((j) => j.def.id)).toEqual(['hello', 'log-summary', 'export-report', 'dag-hello', 'dag-fanout', 'dag-soc-enrich']);
    expect(c.errors).toHaveLength(1);
  });
  it('has runs in every state, and a submitted run moves queued -> running -> succeeded over reads', async () => {
    const api = createFixtureApi({ delayMs: 0 });
    const all = await api.listRuns({ page_size: 100 });
    const states = new Set(all.runs.map((t) => t.backend_state));
    for (const s of ['QUEUED', 'INITIALIZING', 'RUNNING', 'PAUSED', 'COMPLETE', 'EXECUTOR_ERROR', 'SYSTEM_ERROR', 'CANCELED', 'PREEMPTED']) expect(states.has(s)).toBe(true);
    expect(new Set(all.runs.map((t) => t.state))).toEqual(new Set(['queued', 'starting', 'running', 'succeeded', 'failed', 'cancelled', 'unknown']));
    expect((await api.listRuns({ state: 'failed', page_size: 100 })).runs).toHaveLength(4); // executor error, system error, preempted, and the DAG run with a failed branch
    const { id } = await api.submitJob({ job: 'hello', params: {} });
    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) seen.push((await api.getRun(id, 'full')).state);
    expect(seen[0]).toBe('queued');
    expect(seen).toContain('running');
    expect(seen[5]).toBe('succeeded');
    expect((await api.getRun(id, 'full')).tags['vectis.catalog_repo']).toBe(FIXTURE_REPO);
  });
  it('refuses bad parameters like the server and cancels only active runs', async () => {
    const api = createFixtureApi({ delayMs: 0 });
    await expect(api.submitJob({ job: 'log-summary', params: { input_url: 'nope', output_url: 's3://b/o.json' } })).rejects.toMatchObject({ status: 400 });
    await expect(api.cancelRun('run-0002')).rejects.toBeInstanceOf(JobsApiError);
    await api.cancelRun('run-0001');
    expect((await api.getRun('run-0001', 'summary')).state).toBe('cancelled');
  });
});

describe('live client', () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  it('maps errors to JobsApiError with sanitized text', async () => {
    const api = createLiveApi(reply(403, { error: 'Forbidden‮' }) as unknown as typeof fetch);
    await expect(api.submitJob({ job: 'x', params: {} })).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
  });
  it('reports an unreachable service as status 0 and rejects unsafe ids before calling', async () => {
    const f = vi.fn(async () => { throw new TypeError('network'); });
    const api = createLiveApi(f as unknown as typeof fetch);
    await expect(api.catalog()).rejects.toMatchObject({ status: 0 });
    await expect(api.getRun('../etc', 'full')).rejects.toMatchObject({ status: 400 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('cancels with the :cancel form', async () => {
    const f = reply(200, {});
    await createLiveApi(f as unknown as typeof fetch).cancelRun('abc-1');
    expect(f.mock.calls[0]).toEqual(['/api/jobs/runs/abc-1:cancel', expect.objectContaining({ method: 'POST' })]);
  });
});

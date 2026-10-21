/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRuns, handleSubmit, realDeps, type JobsDeps } from './handlers';
import { groupScope, personalScope, type HistoryClient, type HistoryRecord } from './history';
import type { Run } from './model';
import { RunnerError, type Runner } from './runner';
import { DAG_HELLO } from './testing/definitions';

const ME = 'dev@example.org';
beforeEach(() => { vi.stubEnv('DAGU_ALLOWED_EXECUTORS', 'command,http,jq'); });
afterEach(() => vi.unstubAllEnvs());
const out = () => {
  const o: { status?: number; json?: unknown } = {};
  const r = { setHeader: () => undefined, status(n: number) { o.status = n; return this; }, json(b: unknown) { o.json = b; return this; }, send(b: unknown) { o.json = b; return this; } };
  return { o, r: r as never };
};
const get = (route: string[], query: Record<string, string> = {}) => ({ method: 'GET', query: { route, ...query }, headers: { cookie: 'x=1' } }) as never;
const post = (route: string[], body: unknown) => ({ method: 'POST', query: { route }, headers: { cookie: 'x=1', 'content-type': 'application/json' }, body }) as never;
const submitReq = (body: unknown) => ({ method: 'POST', query: {}, headers: { cookie: 'x=1', 'content-type': 'application/json' }, body }) as never;

const run = (id: string, over: Partial<Run> = {}): Run => ({ id, backend: 'dagu', name: id.split('.')[0], job: 'adhoc', submitted_by: 'dev', state: 'succeeded', backend_state: '', created_at: '2026-10-19T10:00:00Z', started_at: null, ended_at: null, steps: [], inputs: [], outputs: [], resources: null, tags: {}, ...over });

function rig(opts: { groups?: string[]; live?: Run[]; saved?: HistoryRecord[] } = {}) {
  const store = new Map<string, HistoryRecord>((opts.saved ?? []).map((r) => [r.run.id, r]));
  const puts: Array<{ scope: string; run: Run }> = [];
  const history: HistoryClient = {
    async put(scope, r) { puts.push({ scope, run: r }); store.set(r.id, { scope, run: r, saved_at: '' }); },
    async list(scopes) { return { records: [...store.values()].filter((r) => scopes.includes(r.scope)), next: null }; },
    async get(id) { return store.get(id) ?? null; },
  };
  const live = opts.live ?? [];
  const submitted: Array<{ ctx: unknown; opts: unknown }> = [];
  const runner: Runner = {
    id: 'dagu',
    async submit(_s, ctx, o) { submitted.push({ ctx, opts: o }); live.push(run('hello.new1', { state: 'queued', ...(o?.group ? { group: o.group } : {}) })); return { id: 'hello.new1', warnings: [] }; },
    async list() { return { runs: live, next_page_token: null }; },
    async get(id) { const f = live.find((x) => x.id === id); if (!f) throw new RunnerError(404, 'Run not found.'); return f; },
    cancel: vi.fn(async () => undefined),
    async info() { return null; },
  };
  const deps: JobsDeps = { ...realDeps(), authorize: async () => ({ ok: true, user: ME, token: 't' }), getRunner: () => runner, writeAllowed: () => true, groups: async () => opts.groups ?? [], history: () => history, resultsClient: () => ({ list: async () => [{ name: 'report.md', size: 5 }], file: async () => Buffer.from('hello') }) };
  return { deps, store, puts, submitted, runner };
}

describe('starting a run with a name and a group', () => {
  it('records it under the person with the name they gave', async () => {
    const { deps, puts, submitted } = rig();
    const { o, r } = out();
    await handleSubmit(submitReq({ yaml: DAG_HELLO, title: '  Friday WAF review ' }), r, deps);
    expect(o.status).toBe(200);
    expect(submitted[0].opts).toBeUndefined();
    expect(puts[0]).toMatchObject({ scope: personalScope(ME), run: { id: 'hello.new1', title: 'Friday WAF review' } });
  });
  it('a member can run as a group: the runner is told, and the group owns the record', async () => {
    const { deps, puts, submitted } = rig({ groups: ['soc'] });
    const { o, r } = out();
    await handleSubmit(submitReq({ yaml: DAG_HELLO, group: 'soc' }), r, deps);
    expect(o.status).toBe(200);
    expect(submitted[0].opts).toEqual({ group: 'soc' });
    expect(puts[0].scope).toBe(groupScope('soc'));
  });
  it.each(['platform', 'SOC', '../x', 'soc/..', 42, {}])('refuses a group the person is not in or that is not a name (%j), before anything runs', async (group) => {
    const { deps, puts, submitted } = rig({ groups: ['soc'] });
    const { o, r } = out();
    await handleSubmit(submitReq({ yaml: DAG_HELLO, group }), r, deps);
    expect(o.status).toBe(403);
    expect(submitted).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });
  it.each(['a'.repeat(81), 'two\nlines', 7])('refuses a name that is too long, has a newline or is not text (%j)', async (title) => {
    const { deps, submitted } = rig();
    const { o, r } = out();
    await handleSubmit(submitReq({ yaml: DAG_HELLO, title }), r, deps);
    expect(o.status).toBe(400);
    expect(submitted).toHaveLength(0);
  });
  it('a run still starts when the history cannot be written', async () => {
    const { deps } = rig();
    deps.history = () => ({ put: async () => { throw new Error('down'); }, list: async () => { throw new Error('down'); }, get: async () => { throw new Error('down'); } });
    const { o, r } = out();
    await handleSubmit(submitReq({ yaml: DAG_HELLO, title: 'x' }), r, deps);
    expect(o.status).toBe(200);
  });
});

describe('the list, the run view and results', () => {
  const saved = (id: string, scope: string, over: Partial<Run> = {}): HistoryRecord => ({ scope, run: run(id, over), saved_at: '' });
  it('lists the person\'s runs and their groups\' runs, and the scope parameter narrows it', async () => {
    const { deps } = rig({ groups: ['soc'], saved: [saved('mine.1', personalScope(ME)), saved('team.1', groupScope('soc'), { group: 'soc' }), saved('bob.1', personalScope('bob')), saved('other.1', groupScope('platform'), { group: 'platform' })] });
    const ids = async (q: Record<string, string> = {}) => { const { o, r } = out(); await handleRuns(get(['runs'], q), r, deps); return ((o.json as { runs: Run[] }).runs).map((x) => x.id).sort(); };
    expect(await ids()).toEqual(['mine.1', 'team.1']);
    expect(await ids({ scope: 'mine' })).toEqual(['mine.1']);
    expect(await ids({ scope: 'shared' })).toEqual(['team.1']);
    const { o, r } = out();
    await handleRuns(get(['runs'], { scope: 'everyone' }), r, deps);
    expect(o.status).toBe(400);
  });
  it('shows a run the workflow server forgot, as archived, and its results', async () => {
    const { deps } = rig({ saved: [saved('hello.old1', personalScope(ME))] });
    const a = out();
    await handleRuns(get(['runs', 'hello.old1']), a.r, deps);
    expect(a.o.status).toBe(200);
    expect(a.o.json).toMatchObject({ id: 'hello.old1', archived: true });
    const b = out();
    await handleRuns(get(['runs', 'hello.old1', 'results']), b.r, deps);
    expect(b.o.status).toBe(200);
    expect((b.o.json as { files: unknown[] }).files).toHaveLength(1);
  });
  it('never shows or serves the results of someone else\'s run, or a group the person is not in', async () => {
    const { deps } = rig({ groups: [], saved: [saved('bob.1', personalScope('bob')), saved('team.1', groupScope('soc'), { group: 'soc' })] });
    for (const id of ['bob.1', 'team.1', 'nothing.1']) {
      for (const route of [['runs', id], ['runs', id, 'results'], ['runs', id, 'results', 'report.md']]) {
        const { o, r } = out();
        await handleRuns(get(route), r, deps);
        expect(o.status, route.join('/')).toBe(404);
      }
    }
  });
  it('the groups route lists only the groups the person is in', async () => {
    const { deps } = rig({ groups: ['soc', 'platform'] });
    const { o, r } = out();
    await handleRuns(get(['groups']), r, deps);
    expect(o.json).toEqual({ groups: ['soc', 'platform'] });
  });
});

describe('renaming a run', () => {
  it('names a run the person owns, and a group run for a member', async () => {
    const { deps, store } = rig({ groups: ['soc'], saved: [{ scope: personalScope(ME), run: run('mine.1'), saved_at: '' }, { scope: groupScope('soc'), run: run('team.1', { group: 'soc' }), saved_at: '' }] });
    for (const id of ['mine.1', 'team.1']) {
      const { o, r } = out();
      await handleRuns(post(['runs', `${id}:rename`], { title: 'Reviewed' }), r, deps);
      expect(o.status, id).toBe(200);
      expect(store.get(id)?.run.title).toBe('Reviewed');
    }
  });
  it('is refused for someone else\'s run, a bad name, or a cross-site request', async () => {
    const { deps, store } = rig({ groups: [], saved: [{ scope: personalScope('bob'), run: run('bob.1'), saved_at: '' }, { scope: personalScope(ME), run: run('mine.1'), saved_at: '' }] });
    const a = out();
    await handleRuns(post(['runs', 'bob.1:rename'], { title: 'mine now' }), a.r, deps);
    expect(a.o.status).toBe(404);
    expect(store.get('bob.1')?.run.title).toBeUndefined();
    const b = out();
    await handleRuns(post(['runs', 'mine.1:rename'], { title: 'x\ny' }), b.r, deps);
    expect(b.o.status).toBe(400);
    const c = out();
    await handleRuns(post(['runs', 'mine.1:rename'], { title: 'ok' }), c.r, { ...deps, writeAllowed: () => false });
    expect(c.o.status).toBe(403);
    expect(store.get('mine.1')?.run.title).toBeUndefined();
  });
});

/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { groupScope, personalScope, type HistoryClient, type HistoryRecord } from './history';
import { cleanTitle, compact, listRuns, openRun, recordSubmitted, renameRun, type Flow } from './historyFlow';
import type { Run, RunState } from './model';
import { RunnerError, type Runner } from './runner';

const run = (id: string, state: RunState = 'running', over: Partial<Run> = {}): Run => ({
  id, backend: 'dagu', name: id.split('.')[0], job: 'nb', submitted_by: 'alice', state, backend_state: '', created_at: '2026-10-19T10:00:00Z',
  started_at: null, ended_at: null, steps: [{ index: 0, name: 's1', depends_on: [], state, error: null, logs_loaded: true, image: 'quay.io/x', command: ['echo', 'sk-live-SECRET'], exit_code: null, started_at: null, ended_at: null, stdout: 'out', stderr: '', truncated: false }],
  inputs: [], outputs: [], resources: null, tags: { 'vectis.job': 'nb', 'other.thing': 'x' }, params: { days: '3' }, ...over,
});

function memHistory() {
  const store = new Map<string, HistoryRecord>();
  const puts: Array<{ scope: string; run: Run }> = [];
  const h: HistoryClient = {
    async put(scope, r) { puts.push({ scope, run: r }); store.set(r.id, { scope, run: r, saved_at: 'now' }); },
    async list(scopes, after, limit) {
      const all = [...store.values()].filter((r) => scopes.includes(r.scope)).sort((a, b) => Date.parse(b.run.created_at ?? '') - Date.parse(a.run.created_at ?? ''));
      const start = after ? all.findIndex((r) => r.run.id === after) + 1 : 0;
      const slice = all.slice(start, start + limit);
      return { records: slice, next: start + limit < all.length ? slice[slice.length - 1].run.id : null };
    },
    async get(id) { return store.get(id) ?? null; },
  };
  return { h, store, puts };
}

function fakeRunner(live: Run[] = [], listed: Run[] = live) {
  const calls: string[] = [];
  const gone = new Set<string>();
  const r: Runner = {
    id: 'dagu',
    async submit() { return { id: 'x', warnings: [] }; },
    async list() { calls.push('list'); return { runs: listed.filter((x) => !gone.has(x.id)), next_page_token: null }; },
    async get(id) {
      calls.push(`get:${id}`);
      const found = live.find((x) => x.id === id);
      if (!found || gone.has(id)) throw new RunnerError(404, 'Run not found.');
      return found;
    },
    async cancel() { /* unused */ },
    async info() { return null; },
  };
  return { r, calls, gone };
}

const ALICE = 'alice';
const flow = (runner: Runner, history: HistoryClient | null, groups: string[] = []): Flow => ({ runner, history, ctx: { user: ALICE, token: 't', groups }, now: () => new Date('2026-10-19T12:00:00Z') });

describe('what is kept of a run', () => {
  it('drops logs, commands, images and any tag that is not the portal\'s', () => {
    const c = compact(run('nb.r1'));
    expect(JSON.stringify(c)).not.toContain('sk-live-SECRET');
    expect(c.steps[0]).toMatchObject({ command: [], stdout: '', image: '', logs_loaded: false, name: 's1' });
    expect(c.tags).toEqual({ 'vectis.job': 'nb' });
    expect(c.params).toEqual({ days: '3' });
  });
  it('titles: trimmed, one line, 80 characters at most', () => {
    expect(cleanTitle('  WAF check  ')).toBe('WAF check');
    expect(cleanTitle('')).toBeUndefined();
    expect(cleanTitle(undefined)).toBeUndefined();
    for (const bad of ['a'.repeat(81), 'two\nlines', 'tab\tinside', 42, {}, 'nul\u0000']) expect(cleanTitle(bad), String(bad)).toBeNull();
  });
});

describe('recording a submitted run', () => {
  it('saves it under the person with the name they gave', async () => {
    const { h, store } = memHistory();
    const { r } = fakeRunner([run('nb.r1', 'queued')]);
    await recordSubmitted(flow(r, h), 'nb.r1', { title: 'Friday WAF review' });
    expect(store.get('nb.r1')).toMatchObject({ scope: personalScope(ALICE), run: { title: 'Friday WAF review' } });
  });
  it('saves a group run under the group, and the person cannot also hold it', async () => {
    const { h, store } = memHistory();
    const { r } = fakeRunner([run('nb.r2', 'queued', { group: 'soc' })]);
    await recordSubmitted(flow(r, h, ['soc']), 'nb.r2', { group: 'soc' });
    expect(store.get('nb.r2')?.scope).toBe(groupScope('soc'));
  });
  it('never fails the run when the history cannot be written, or the run cannot be read back', async () => {
    const { r } = fakeRunner([run('nb.r1')]);
    const broken: HistoryClient = { put: async () => { throw new Error('down'); }, list: async () => { throw new Error('down'); }, get: async () => { throw new Error('down'); } };
    await expect(recordSubmitted(flow(r, broken), 'nb.r1', {})).resolves.toBeUndefined();
    await expect(recordSubmitted(flow(fakeRunner([]).r, memHistory().h), 'nb.zz', {})).resolves.toBeUndefined();
  });
  it('does nothing without a history', async () => {
    const { r, calls } = fakeRunner([run('nb.r1')]);
    await recordSubmitted(flow(r, null), 'nb.r1', { title: 't' });
    expect(calls).toEqual([]);
  });
});

describe('the list', () => {
  it('without a history is the engine\'s list', async () => {
    const { r } = fakeRunner([run('nb.r1')]);
    expect((await listRuns(flow(r, null), {})).runs.map((x) => x.id)).toEqual(['nb.r1']);
  });
  it('shows a run after the engine has forgotten it, and a group run to a member only', async () => {
    const { h, store } = memHistory();
    store.set('old.r1', { scope: personalScope(ALICE), run: run('old.r1', 'succeeded', { created_at: '2026-10-18T10:00:00Z', title: 'Yesterday' }), saved_at: '' });
    store.set('team.r1', { scope: groupScope('soc'), run: run('team.r1', 'succeeded', { group: 'soc', created_at: '2026-10-18T11:00:00Z' }), saved_at: '' });
    store.set('bob.r1', { scope: personalScope('bob'), run: run('bob.r1', 'succeeded'), saved_at: '' });
    store.set('other.r1', { scope: groupScope('platform'), run: run('other.r1', 'succeeded', { group: 'platform' }), saved_at: '' });
    const { r } = fakeRunner([]); // the engine has nothing: its volume was replaced
    const member = await listRuns(flow(r, h, ['soc']), {});
    expect(member.runs.map((x) => x.id).sort()).toEqual(['old.r1', 'team.r1']);
    expect(member.runs.find((x) => x.id === 'old.r1')?.title).toBe('Yesterday');
    const outsider = await listRuns(flow(r, h, []), {});
    expect(outsider.runs.map((x) => x.id)).toEqual(['old.r1']); // not the group's, never bob's, never platform's
  });
  it('scope mine / shared / all', async () => {
    const { h, store } = memHistory();
    store.set('a.r1', { scope: personalScope(ALICE), run: run('a.r1', 'succeeded'), saved_at: '' });
    store.set('t.r1', { scope: groupScope('soc'), run: run('t.r1', 'succeeded', { group: 'soc' }), saved_at: '' });
    const { r } = fakeRunner([]);
    const ids = async (s: 'mine' | 'shared' | 'all') => (await listRuns(flow(r, h, ['soc']), {}, s)).runs.map((x) => x.id).sort();
    expect(await ids('mine')).toEqual(['a.r1']);
    expect(await ids('shared')).toEqual(['t.r1']);
    expect(await ids('all')).toEqual(['a.r1', 't.r1']);
    expect((await listRuns(flow(r, h, []), {}, 'shared')).runs).toEqual([]);
  });
  it('imports runs the engine still has that the history lacks, keeping a saved name', async () => {
    const { h, store, puts } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'running', { title: 'Mine' }), saved_at: '' });
    const { r } = fakeRunner([run('nb.r1', 'succeeded'), run('nb.r2', 'running', { created_at: '2026-10-19T11:00:00Z' })]);
    const out = await listRuns(flow(r, h), {});
    expect(out.runs.map((x) => x.id)).toEqual(['nb.r2', 'nb.r1']);
    expect(out.runs.find((x) => x.id === 'nb.r1')).toMatchObject({ state: 'succeeded', title: 'Mine' });
    expect(puts.map((p) => p.run.id).sort()).toEqual(['nb.r1', 'nb.r2']);
    expect(store.get('nb.r1')?.run.title).toBe('Mine');
  });
  it('writes nothing when nothing changed', async () => {
    const { h, store, puts } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'succeeded'), saved_at: '' });
    const { r } = fakeRunner([run('nb.r1', 'succeeded')]);
    await listRuns(flow(r, h), {});
    expect(puts).toHaveLength(0);
  });
  it('marks a run the engine forgot while it was last seen running as archived, once', async () => {
    const { h, store, puts } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'running'), saved_at: '' });
    const { r, calls } = fakeRunner([]);
    const first = await listRuns(flow(r, h), {});
    expect(first.runs[0]).toMatchObject({ state: 'unknown', archived: true });
    expect(puts).toHaveLength(1);
    await listRuns(flow(r, h), {});
    expect(calls.filter((c) => c === 'get:nb.r1')).toHaveLength(1); // not asked again
    expect(puts).toHaveLength(1);
    expect(store.get('nb.r1')?.run.archived).toBe(true);
  });
  it('still lists from the history when the engine is down', async () => {
    const { h, store } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'succeeded'), saved_at: '' });
    const down: Runner = { ...fakeRunner().r, list: async () => { throw new RunnerError(503, 'down'); } };
    expect((await listRuns(flow(down, h), {})).runs.map((x) => x.id)).toEqual(['nb.r1']);
  });
  it('filters by name or title text and by state', async () => {
    const { h, store } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'succeeded', { title: 'Friday WAF review' }), saved_at: '' });
    store.set('hello.r2', { scope: personalScope(ALICE), run: run('hello.r2', 'failed'), saved_at: '' });
    const { r } = fakeRunner([]);
    const ids = async (q: object) => (await listRuns(flow(r, h), q)).runs.map((x) => x.id);
    expect(await ids({ name_prefix: 'waf' })).toEqual(['nb.r1']);
    expect(await ids({ name_prefix: 'hel' })).toEqual(['hello.r2']);
    expect(await ids({ state: 'failed' })).toEqual(['hello.r2']);
  });
});

describe('opening one run', () => {
  it('adds the saved name to what the engine says, and saves a finished run\'s state', async () => {
    const { h, store, puts } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'running', { title: 'Mine' }), saved_at: '' });
    const { r } = fakeRunner([run('nb.r1', 'succeeded')]);
    const out = await openRun(flow(r, h), 'nb.r1');
    expect(out.run).toMatchObject({ title: 'Mine', state: 'succeeded' });
    expect(puts).toHaveLength(1);
    await openRun(flow(r, h), 'nb.r1');
    expect(puts).toHaveLength(1); // the stored copy now says the same, so it is not written again
  });
  it('does not write while the run is still going', async () => {
    const { h, store, puts } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'running'), saved_at: '' });
    await openRun(flow(fakeRunner([run('nb.r1', 'running')]).r, h), 'nb.r1');
    expect(puts).toHaveLength(0);
  });
  it('falls back to the saved summary, archived, for its owner and for group members only', async () => {
    const { h, store } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'succeeded'), saved_at: '' });
    store.set('nb.r2', { scope: groupScope('soc'), run: run('nb.r2', 'succeeded', { group: 'soc' }), saved_at: '' });
    const { r } = fakeRunner([]);
    expect((await openRun(flow(r, h), 'nb.r1')).run.archived).toBe(true);
    expect((await openRun(flow(r, h, ['soc']), 'nb.r2')).run.archived).toBe(true);
    await expect(openRun(flow(r, h, []), 'nb.r2')).rejects.toMatchObject({ status: 404 });
    store.set('nb.r3', { scope: personalScope('bob'), run: run('nb.r3', 'succeeded'), saved_at: '' });
    await expect(openRun(flow(r, h), 'nb.r3')).rejects.toMatchObject({ status: 404 });
  });
  it('a failure that is not "not found" is not hidden by the saved copy', async () => {
    const { h, store } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'succeeded'), saved_at: '' });
    const down: Runner = { ...fakeRunner().r, get: async () => { throw new RunnerError(502, 'bad gateway'); } };
    await expect(openRun(flow(down, h), 'nb.r1')).rejects.toMatchObject({ status: 502 });
  });
});

describe('naming a run', () => {
  it('sets, changes and clears the name; others cannot', async () => {
    const { h, store } = memHistory();
    store.set('nb.r1', { scope: personalScope(ALICE), run: run('nb.r1', 'succeeded'), saved_at: '' });
    const { r } = fakeRunner([run('nb.r1', 'succeeded')]);
    expect((await renameRun(flow(r, h), 'nb.r1', 'Friday')).title).toBe('Friday');
    expect(store.get('nb.r1')?.run.title).toBe('Friday');
    expect((await renameRun(flow(r, h), 'nb.r1', undefined)).title).toBeUndefined();
    expect(store.get('nb.r1')?.run.title).toBeUndefined();
    store.set('nb.r9', { scope: personalScope('bob'), run: run('nb.r9', 'succeeded'), saved_at: '' });
    await expect(renameRun(flow(fakeRunner([]).r, h), 'nb.r9', 'mine now')).rejects.toMatchObject({ status: 404 });
    expect(store.get('nb.r9')?.run.title).toBeUndefined();
  });
  it('a group member can name a group run', async () => {
    const { h, store } = memHistory();
    store.set('nb.r2', { scope: groupScope('soc'), run: run('nb.r2', 'succeeded', { group: 'soc' }), saved_at: '' });
    await renameRun(flow(fakeRunner([]).r, h, ['soc']), 'nb.r2', 'Team review');
    expect(store.get('nb.r2')?.run.title).toBe('Team review');
    await expect(renameRun(flow(fakeRunner([]).r, h, []), 'nb.r2', 'x')).rejects.toMatchObject({ status: 404 });
  });
});

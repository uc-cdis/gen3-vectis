/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { RUN_STATES, TERMINAL, isActive, isCancellable, isRunId, normalizeRun, normalizeRunList, normalizeServiceInfo } from './model';
import { fromTesTask, tesStatesFor, TES_TO_RUN_STATE } from './tes/adapter';
import { normalizeTask } from './tes/normalize';
import { TES_STATES } from './tes/types';

const tes = (over: Record<string, unknown> = {}) => normalizeTask({ id: 't1', name: 'N', state: 'COMPLETE', executors: [{ image: 'i', command: ['c', 'a b'] }], ...over })!;

describe('fromTesTask: state mapping', () => {
  it.each([
    ['QUEUED', 'queued'], ['INITIALIZING', 'starting'], ['RUNNING', 'running'], ['PAUSED', 'running'], ['COMPLETE', 'succeeded'],
    ['EXECUTOR_ERROR', 'failed'], ['SYSTEM_ERROR', 'failed'], ['PREEMPTED', 'failed'], ['CANCELED', 'cancelled'], ['CANCELING', 'running'], ['UNKNOWN', 'unknown'],
  ] as const)('%s -> %s, and the raw word is kept', (from, to) => {
    const r = fromTesTask(tes({ state: from }));
    expect(r.state).toBe(to);
    expect(r.backend_state).toBe(from);
    expect(r.backend).toBe('tes');
  });
  it('covers every TES state and every neutral state', () => {
    expect(Object.keys(TES_TO_RUN_STATE).sort()).toEqual([...TES_STATES].sort());
    for (const s of RUN_STATES) expect(tesStatesFor(s).length, s).toBeGreaterThan(0);
    expect(tesStatesFor('failed').sort()).toEqual(['EXECUTOR_ERROR', 'PREEMPTED', 'SYSTEM_ERROR']);
  });
  it('an unrecognised state is unknown, never success', () => {
    expect(fromTesTask(tes({ state: 'EXPLODED' })).state).toBe('unknown');
    expect(fromTesTask(tes({ state: undefined })).state).toBe('unknown');
  });
});

describe('fromTesTask: fields', () => {
  it('maps job, submitter, times, steps, files and sizes; missing data is null, never 0', () => {
    const r = fromTesTask(tes({
      creation_time: '2026-10-01T10:00:00Z',
      tags: { 'vectis.job': 'hello', 'vectis.submitted_by': 'me' },
      inputs: [{ name: 'in', path: '/in', url: 's3://b/in' }, { path: '/c', content: 'x' }],
      outputs: [{ name: 'o', path: '/a', url: 's3://my-bucket/a' }, { path: '/b', url: 's3://my-bucket/b' }],
      executors: [{ image: 'a', command: ['x'] }, { image: 'b', command: ['y'] }],
      logs: [{ start_time: '2026-10-01T10:00:01Z', end_time: '2026-10-01T10:00:05Z', logs: [{ exit_code: 0, stdout: 'hi', start_time: '2026-10-01T10:00:01Z' }], outputs: [{ url: 's3://my-bucket/a', path: '/a', size_bytes: '48213' }], system_logs: ['s'] }],
    }));
    expect(r).toMatchObject({ job: 'hello', submitted_by: 'me', created_at: '2026-10-01T10:00:00Z', started_at: '2026-10-01T10:00:01Z', ended_at: '2026-10-01T10:00:05Z', system_logs: ['s'] });
    expect(r.steps[0]).toMatchObject({ index: 0, image: 'a', command: ['x'], exit_code: 0, stdout: 'hi', truncated: false });
    expect(r.steps[1]).toMatchObject({ index: 1, exit_code: null, started_at: null, ended_at: null, stdout: '', stderr: '' });
    expect(r.inputs).toEqual([{ name: 'in', url: 's3://b/in', path: '/in' }, { name: '', url: null, path: '/c' }]);
    expect(r.outputs.map((o) => o.size_bytes)).toEqual([48213, null]);
  });
  it('a run with no tags or times has nulls', () => {
    const r = fromTesTask(tes({ state: 'RUNNING' }));
    expect(r).toMatchObject({ job: null, submitted_by: null, created_at: null, started_at: null, ended_at: null, resources: null });
  });
  it('an output size that does not fit a safe integer is unknown, not rounded', () => {
    const r = fromTesTask(tes({ outputs: [{ path: '/a', url: 's3://my-bucket/a' }], logs: [{ outputs: [{ url: 's3://my-bucket/a', path: '/a', size_bytes: '9223372036854775807' }] }] }));
    expect(r.outputs[0].size_bytes).toBeNull();
  });
  it('never carries executor env values', () => {
    expect(JSON.stringify(fromTesTask(tes({ executors: [{ image: 'i', command: ['c'], env: { TOKEN: 'hunter2' } }] })))).not.toContain('hunter2');
  });
});

describe('run helpers', () => {
  it('terminal, active and cancellable', () => {
    expect([...TERMINAL]).toEqual(['succeeded', 'failed', 'cancelled']);
    expect(isActive({ state: 'unknown' })).toBe(true);
    expect(isActive({ state: 'succeeded' })).toBe(false);
    expect(RUN_STATES.filter(isCancellable)).toEqual(['queued', 'starting', 'running']);
  });
  it('run ids are safe path segments', () => {
    for (const id of ['', '.', '..', 'a/b', 'a:cancel', 'a b', 'x'.repeat(129), 5, null]) expect(isRunId(id), String(id)).toBe(false);
    expect(isRunId('3f2a-1.x_Z')).toBe(true);
  });
});

describe('normalizeRun (browser side, defence in depth)', () => {
  it('re-sanitises a hostile wire run and caps log text', () => {
    const r = normalizeRun({
      id: 'a', backend: 'EVIL!', state: 'exploded', name: 'n‮\u001b', backend_state: 'X'.repeat(500),
      steps: [{ image: 'i', command: ['c'], exit_code: 'x', stdout: `a‮${'z'.repeat(70000)}`, stderr: 5 }],
      outputs: [{ url: 'u', path: 'p', size_bytes: -1 }], tags: { __proto__: 'x', k: { a: 1 } },
    })!;
    expect(r.backend).toBe('unknown'); expect(r.state).toBe('unknown');
    expect(r.name).toBe('n'); expect(r.backend_state.length).toBeLessThanOrEqual(64);
    expect(r.steps[0].exit_code).toBeNull(); expect(r.steps[0].stdout.length).toBe(65536); expect(r.steps[0].truncated).toBe(true); expect(r.steps[0].stdout).not.toContain('‮');
    expect(r.outputs[0].size_bytes).toBeNull();
    expect(r.created_at).toBeNull(); expect(r.job).toBeNull();
  });
  it('rejects runs without a safe id, and bad list entries are dropped', () => {
    for (const id of [undefined, '../x', 'a/b', 5]) expect(normalizeRun({ id })).toBeNull();
    expect(normalizeRunList({ runs: [{ id: 'a' }, { id: '../b' }, 7], next_page_token: 'a b' })).toEqual({ runs: [expect.objectContaining({ id: 'a' })], next_page_token: null });
    expect(normalizeRunList('x')).toBeNull();
  });
  it('a server run round-trips', () => {
    const r = fromTesTask(tes({ state: 'RUNNING', tags: { 'vectis.job': 'j' } }));
    expect(normalizeRun(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it('service info exposes only name and version', () => {
    expect(normalizeServiceInfo({ name: 'TES', version: '1.1', contactUrl: 'x', storage: ['s3://secret'] })).toEqual({ name: 'TES', version: '1.1' });
    expect(normalizeServiceInfo('x')).toBeNull();
  });
});

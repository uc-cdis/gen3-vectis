/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { normalizeRun } from '../model';
import { NODE_STATUS, RUN_STATUS, composeRunId, fromDagu, labelMap, mapNode, ownedBy, parseParams, parseRunId, redactPaths, statusesFor } from './map';

describe('status tables (documented in the README)', () => {
  it('maps every documented Dagu status to the neutral state in the README', () => {
    expect(RUN_STATUS).toEqual({ 0: 'queued', 1: 'running', 2: 'failed', 3: 'cancelled', 4: 'succeeded', 5: 'queued', 6: 'failed', 7: 'running', 8: 'failed' });
    expect(NODE_STATUS).toEqual({ 0: 'queued', 1: 'running', 2: 'failed', 3: 'cancelled', 4: 'succeeded', 5: 'cancelled', 6: 'failed', 7: 'running', 8: 'failed', 9: 'running' });
    expect(statusesFor('queued')).toEqual([0, 5]);
    expect(statusesFor('running')).toEqual([1, 7]);
    expect(statusesFor('starting')).toEqual([]);
    expect(statusesFor('unknown')).toEqual([]);
  });
  it('an object key that is not a status is unknown (no prototype lookups)', () => {
    for (const status of ['toString', '__proto__', 'constructor', -1, 1.5, null, 'running', NaN]) {
      expect(fromDagu({ name: 'a', dagRunId: 'b', status })?.state, String(status)).toBe('unknown');
      expect(mapNode({ step: { name: 's' }, status }, 0).state, String(status)).toBe('unknown');
    }
  });
});

describe('run ids', () => {
  it('round-trips and refuses everything else, including the latest alias in any case', () => {
    expect(parseRunId(composeRunId('fanout', 'abc_DEF-123'))).toEqual({ name: 'fanout', dagRunId: 'abc_DEF-123' });
    for (const bad of ['fanout', 'fanout.latest', 'fanout.Latest', 'a.b.c', '.x', 'x.', 'a b.c', 'a/b.c', 'a..b', '../x.y', '', 42, null, `${'a'.repeat(65)}.x`]) expect(parseRunId(bad), String(bad)).toBeNull();
  });
});

describe('labels and ownership', () => {
  it('only an exact single owner label counts', () => {
    expect(ownedBy(['vectis.owner=abc'], 'abc')).toBe(true);
    expect(ownedBy(['vectis.owner=abc', 'vectis.owner=abc'], 'abc')).toBe(false);
    expect(ownedBy(['vectis.owner=abd'], 'abc')).toBe(false);
    expect(ownedBy(['vectis.owner=abcd'], 'abc')).toBe(false);
    expect(ownedBy(['x.vectis.owner=abc'], 'abc')).toBe(false);
    expect(ownedBy(['vectis.owner = abc'], 'abc')).toBe(false);
    expect(ownedBy('vectis.owner=abc', 'abc')).toBe(false);
    expect(ownedBy(undefined, 'abc')).toBe(false);
    expect(ownedBy([], '')).toBe(false);
  });
  it('labelMap never lets a label pollute prototypes and drops the owner hash from the visible map', () => {
    const { map, owners } = labelMap(['__proto__=x', 'a=b', 'vectis.owner=zz', 5, 'bad label=x']);
    expect(map).toEqual({ a: 'b' });
    expect(owners).toEqual(['zz']);
  });
});

describe('text helpers', () => {
  it('redactPaths hides server paths but not urls', () => {
    expect(redactPaths('open /var/lib/dagu/logs/x.out: no such file')).toBe('open <path>: no such file');
    expect(redactPaths('GET https://intel.example.org/api/v1/x failed')).toBe('GET https://intel.example.org/api/v1/x failed');
    expect(redactPaths('in /home/dagu/.config/x and /tmp/y')).toBe('in <path> and <path>');
  });
  it('parseParams reads what the portal sent and bounds the rest', () => {
    expect(parseParams('label=alpha n="1 2"')).toEqual({ label: 'alpha', n: '1 2' });
    expect(parseParams(undefined)).toEqual({});
    expect(Object.keys(parseParams(Array.from({ length: 100 }, (_, i) => `p${i}=x`).join(' '))).length).toBe(32);
  });
});

describe('the neutral Run re-validates what the server sends (defence in depth)', () => {
  it('keeps the new step fields and drops hostile ones', () => {
    const r = normalizeRun({ id: 'a.b', backend: 'dagu', name: 'a', state: 'running', steps: [{ name: 's‮1', depends_on: ['x', 5, 'y'], state: 'nonsense', error: 'e', image: 'http', command: [], exit_code: 2.5, stdout: '', stderr: '' }], params: { a: '1', b: { c: 1 } } });
    expect(r?.steps[0]).toMatchObject({ name: 's1', depends_on: ['x', 'y'], state: null, error: 'e', exit_code: null });
    expect(r?.params).toEqual({ a: '1' });
    expect(normalizeRun({ id: 'a.b', steps: [{ state: 'failed' }] })?.steps[0].state).toBe('failed');
  });
});

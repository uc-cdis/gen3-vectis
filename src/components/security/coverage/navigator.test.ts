import { describe, expect, it } from 'vitest';
import type { CoverageRow } from '@/lib/vectis-kit/spec';
import { buildNavigatorLayer, TECHNIQUE_ID } from './navigator';

const row = (technique_id: string, verdict: CoverageRow['verdict'], replay = 'sample-intrusion', step = 1): CoverageRow => ({ technique_id, verdict, replay, step });
const RUN = '2026-10-09T12:00:00Z';

describe('buildNavigatorLayer', () => {
  it('produces the layer 4.5 envelope for an empty result', () => {
    const { layer, included, rejected } = buildNavigatorLayer({ rows: [], run_at: RUN });
    expect(layer.techniques).toEqual([]);
    expect(included).toBe(0);
    expect(rejected).toBe(0);
    expect(layer.versions.layer).toBe('4.5');
    expect(layer.domain).toBe('enterprise-attack');
    expect(layer.name).toBe('Vectis detection coverage 2026-10-09');
    expect(layer.legendItems.map((l) => l.label)).toEqual(['Caught by both', 'Rule only', 'Behavioral only', 'Missed']);
    expect(JSON.parse(JSON.stringify(layer))).toEqual(layer); // plain JSON
  });

  it('maps every verdict to a distinct colour and score, with technique ids sorted', () => {
    const { layer } = buildNavigatorLayer({ rows: [row('T1190', 'both'), row('T1059.001', 'rule'), row('T1041', 'behavioral'), row('T1078', 'missed')], run_at: RUN });
    expect(layer.techniques.map((t) => t.techniqueID)).toEqual(['T1041', 'T1059.001', 'T1078', 'T1190']);
    expect(new Set(layer.techniques.map((t) => t.color)).size).toBe(4);
    expect(new Set(layer.techniques.map((t) => t.score)).size).toBe(4);
    const by = Object.fromEntries(layer.techniques.map((t) => [t.techniqueID, t]));
    expect(by.T1078!.score).toBe(0);
    expect(by.T1190!.score).toBe(100);
    expect(by.T1078!.comment).toBe('Missed (replay sample-intrusion)');
    for (const t of layer.techniques) expect(t.enabled).toBe(true);
  });

  it('lists a technique once, with its weakest verdict, when several replays hit it', () => {
    const { layer } = buildNavigatorLayer({ rows: [row('T1190', 'both', 'a'), row('T1190', 'missed', 'b'), row('T1190', 'rule', 'c')], run_at: RUN });
    expect(layer.techniques).toHaveLength(1);
    expect(layer.techniques[0]!.score).toBe(0);
    expect(layer.techniques[0]!.comment).toBe('Caught by both (replay a); Missed (replay b); Rule only (replay c)');
  });

  it('rejects hostile technique ids, verdicts and replay names, and counts them', () => {
    const hostile = [
      row('T1190"><script>alert(1)</script>', 'both'),
      row('T1190\n', 'both'),
      row('../../etc/passwd', 'rule'),
      row('t1190', 'rule'),
      row('T119', 'rule'),
      row('T1190', 'both', '<img src=x onerror=1>'),
      row('T1190', 'both', 'a b'),
      row('T1190', 'both', ''),
      { technique_id: 'T1190', verdict: 'pwned', replay: 'x', step: 1 } as unknown as CoverageRow,
      { technique_id: 7, verdict: 'both', replay: 'x', step: 1 } as unknown as CoverageRow,
    ];
    const { layer, rejected, included } = buildNavigatorLayer({ rows: [...hostile, row('T1595', 'rule')], run_at: RUN });
    expect(rejected).toBe(hostile.length);
    expect(included).toBe(1);
    expect(layer.techniques.map((t) => t.techniqueID)).toEqual(['T1595']);
    expect(JSON.stringify(layer)).not.toMatch(/<script|onerror|passwd/);
  });

  it('contains only technique ids, verdict names and replay names from the data', () => {
    const { layer } = buildNavigatorLayer({ rows: [{ ...row('T1190', 'both'), step: 424242, extra: 'SECRET-VALUE' } as CoverageRow], run_at: RUN });
    const json = JSON.stringify(layer);
    expect(json).not.toContain('424242');
    expect(json).not.toContain('SECRET-VALUE');
    expect(Object.keys(layer.techniques[0]!).sort()).toEqual(['color', 'comment', 'enabled', 'score', 'techniqueID']);
  });

  it('does not let an unparseable run date into the name', () => {
    expect(buildNavigatorLayer({ rows: [], run_at: '<b>x</b>' }).layer.name).toBe('Vectis detection coverage');
  });

  it('uses the contract technique id grammar', () => {
    for (const ok of ['T1190', 'T1059.001']) expect(TECHNIQUE_ID.test(ok)).toBe(true);
    for (const bad of ['T1190.1', 'T11900', 'T1190 ', ' T1190']) expect(TECHNIQUE_ID.test(bad)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { TimelinePoint } from '@/lib/vectis-kit/spec';
import { brushEventToRange, buildRollupOption, groupKey, prepareRollup, rangeFromCoords, summarizeRollup, tableRows } from './rollupOption';

const pt = (iso: string, over: Partial<TimelinePoint> = {}): TimelinePoint => ({ bucket_start: iso, event_count: 10, distinct_src_ips: 3, bytes_out_max: 500, bytes_out_sum: 900, dims: {}, ...over });
type Series = { name: string; type: string; yAxisIndex: number; data: [number, number][] };
const seriesOf = (o: unknown): Series[] => (o as { series: Series[] }).series;
const axesOf = (o: unknown) => (o as { yAxis: { name: string }[] }).yAxis;

describe('distinct source addresses that were not exactly measured', () => {
  const pts = [pt('2026-10-09T10:00:00Z', { distinct_src_ips: 4 }), pt('2026-10-09T10:05:00Z', { distinct_src_ips: null }), pt('2026-10-09T10:10:00Z', { distinct_src_ips: 0 })];
  it('leave a gap in the line, and a real zero stays a zero', () => {
    const ips = seriesOf(buildRollupOption(pts, { grain: '5m' }))[1]!;
    expect(ips.data.map((d) => d[1])).toEqual([4, null, 0]);
  });
  it('show a dash in the text alternative, never 0', () => {
    expect(tableRows(pts).rows.map((r) => r.distinctIps)).toEqual([4, null, 0]);
  });
});

describe('buildRollupOption', () => {
  it('returns no series for empty input', () => {
    const o = buildRollupOption([], { grain: '5m' });
    expect(seriesOf(o)).toEqual([]);
    expect(summarizeRollup([], '5m').text).toBe('No data points.');
  });

  it('puts events on axis 0, distinct IPs on axis 1 and bytes markers on axis 2', () => {
    const o = buildRollupOption([pt('2026-10-09T10:00:00Z'), pt('2026-10-09T10:05:00Z', { event_count: 20 })], { grain: '5m' });
    const [events, ips, bytes] = seriesOf(o);
    expect(events).toMatchObject({ type: 'line', yAxisIndex: 0 });
    expect(events!.data).toEqual([[Date.parse('2026-10-09T10:00:00Z'), 10], [Date.parse('2026-10-09T10:05:00Z'), 20]]);
    expect(ips).toMatchObject({ name: 'Distinct source IPs', yAxisIndex: 1 });
    expect(bytes).toMatchObject({ type: 'scatter', yAxisIndex: 2 });
    expect(axesOf(o).map((a) => a.name)).toEqual(['Events', 'Distinct source IPs', 'Max bytes out']);
  });

  it('omits null bytes instead of drawing zero, and drops the bytes series when none exist', () => {
    const mixed = buildRollupOption([pt('2026-10-09T10:00:00Z', { bytes_out_max: null }), pt('2026-10-09T10:05:00Z', { bytes_out_max: 7 })], { grain: '5m' });
    expect(seriesOf(mixed).find((s) => s.type === 'scatter')!.data).toEqual([[Date.parse('2026-10-09T10:05:00Z'), 7]]);
    const none = buildRollupOption([pt('2026-10-09T10:00:00Z', { bytes_out_max: null }), pt('2026-10-09T10:05:00Z', { bytes_out_max: undefined })], { grain: '5m' });
    expect(seriesOf(none).some((s) => s.type === 'scatter')).toBe(false);
    expect(axesOf(none)).toHaveLength(2);
  });

  it('handles a single point and shows its symbol so it is visible', () => {
    const o = buildRollupOption([pt('2026-10-09T10:00:00Z')], { grain: '1h' });
    expect(seriesOf(o)[0]!.data).toHaveLength(1);
    expect((seriesOf(o)[0] as unknown as { showSymbol: boolean }).showSymbol).toBe(true);
    expect(summarizeRollup([pt('2026-10-09T10:00:00Z')], '1h')).toMatchObject({ buckets: 1, totalEvents: 10 });
  });

  it('sorts unordered input and skips unreadable timestamps', () => {
    const prep = prepareRollup([pt('2026-10-09T10:05:00Z'), pt('not a date'), pt('2026-10-09T10:00:00Z')]);
    expect(prep.skipped).toBe(1);
    expect(prep.groups[0]!.events.map((e) => e[0])).toEqual([Date.parse('2026-10-09T10:00:00Z'), Date.parse('2026-10-09T10:05:00Z')]);
  });

  it('draws one event series per group when grouped, largest first, and reports groups it did not draw', () => {
    const pts = [
      pt('2026-10-09T10:00:00Z', { dims: { rule_action: 'ALLOW' }, event_count: 5 }),
      pt('2026-10-09T10:00:00Z', { dims: { rule_action: 'BLOCK' }, event_count: 50 }),
      pt('2026-10-09T10:00:00Z', { dims: { rule_action: null }, event_count: 1 }),
    ];
    const o = buildRollupOption(pts, { grain: '5m', maxGroups: 2 });
    expect(seriesOf(o).map((s) => s.name)).toEqual(['BLOCK', 'ALLOW']);
    expect(prepareRollup(pts, 2).hiddenGroups).toBe(1);
    expect(summarizeRollup(pts, '5m', 2).text).toContain('1 smaller groups not drawn');
    expect(groupKey({ b: 'x', a: null })).toBe('(none) / x');
  });

  it('adds the zoom slider and the brush config only when asked', () => {
    const plain = buildRollupOption([pt('2026-10-09T10:00:00Z')], { grain: '5m' }) as Record<string, unknown>;
    expect(plain.dataZoom).toBeUndefined();
    expect(plain.brush).toBeUndefined();
    const full = buildRollupOption([pt('2026-10-09T10:00:00Z')], { grain: '5m', zoom: true, brush: true }) as Record<string, unknown>;
    expect(full.dataZoom).toEqual([expect.objectContaining({ type: 'slider', xAxisIndex: 0 })]);
    expect(full.brush).toMatchObject({ brushType: 'lineX', xAxisIndex: 0 });
  });
});

describe('brush ranges', () => {
  it('snaps to whole buckets and returns ISO strings', () => {
    const a = Date.parse('2026-10-09T10:02:10Z');
    const b = Date.parse('2026-10-09T10:12:01Z');
    expect(rangeFromCoords(a, b, '5m')).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T10:15:00.000Z' });
    expect(rangeFromCoords(b, a, '5m')).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T10:15:00.000Z' });
  });
  it('never returns an empty range', () => {
    const t = Date.parse('2026-10-09T10:00:00Z');
    expect(rangeFromCoords(t, t, '1h')).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' });
    expect(rangeFromCoords(Number.NaN, t, '1h')).toBeNull();
  });
  it('reads brush events: range, cleared, or unreadable', () => {
    const a = Date.parse('2026-10-09T10:00:00Z');
    expect(brushEventToRange({ areas: [{ coordRange: [a, a + 600_000] }] }, '5m')).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T10:10:00.000Z' });
    expect(brushEventToRange({ areas: [] }, '5m')).toBeNull();
    expect(brushEventToRange({}, '5m')).toBeUndefined();
    expect(brushEventToRange({ areas: [{ coordRange: 'x' }] }, '5m')).toBeUndefined();
    expect(brushEventToRange(null, '5m')).toBeUndefined();
  });
});

describe('text alternative', () => {
  it('summarises totals and the peak', () => {
    const s = summarizeRollup([pt('2026-10-09T10:00:00Z'), pt('2026-10-09T10:05:00Z', { event_count: 99 })], '5m');
    expect(s).toMatchObject({ buckets: 2, totalEvents: 109, peak: { count: 99, at: '2026-10-09T10:05:00.000Z' } });
  });
  it('caps table rows and reports the true total', () => {
    const pts = Array.from({ length: 5 }, (_, i) => pt(`2026-10-09T10:0${i}:00Z`));
    expect(tableRows(pts, 3)).toMatchObject({ total: 5, rows: expect.any(Array) });
    expect(tableRows(pts, 3).rows).toHaveLength(3);
    expect(tableRows([pt('2026-10-09T10:00:00Z', { bytes_out_max: null })]).rows[0]!.bytesMax).toBeNull();
  });
});

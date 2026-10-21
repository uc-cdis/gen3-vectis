import { describe, expect, it } from 'vitest';
import type { AggregateRow, ColumnMeta } from '@/lib/vectis-kit/spec';
import {
  PALETTE, buildBarOption, buildSunburstOption, buildTreemapOption, chartColumns, colorFor, parseCharts, prepareTree, summarizeChart, unfilledDimensions,
} from './aggregateCharts';

const col = (name: string, type: ColumnMeta['type'] = 'string', over: Partial<ColumnMeta> = {}): ColumnMeta =>
  ({ name, label: name, type, description: '', pii: false, default_visible: true, filterable: true, sortable: true, ...over }) as ColumnMeta;
const COLUMNS = [col('id'), col('event_time', 'timestamp'), col('src_ip', 'ip'), col('outcome', 'enum'), col('country'), col('port', 'integer'),
  col('is_admin', 'boolean'), col('total_risk', 'float'), col('user_hash', 'string', { pii: true }), col('tags', 'string', { filterable: false })];

const row = (a: string | null, b: string | null | undefined, count: number): AggregateRow => ({ values: b === undefined ? [a] : [a, b], count });
const chart = (over: Record<string, unknown> = {}) => ({ kind: 'treemap', group_by: ['country', 'outcome'], title: 'T', top_n: 10, ...over });

describe('chartColumns', () => {
  it('offers readable, groupable columns only: no id, timestamp, float, PII or unfilterable column', () => {
    expect(chartColumns(COLUMNS).map((c) => c.name)).toEqual(['src_ip', 'outcome', 'country', 'port', 'is_admin']);
  });
});

describe('parseCharts', () => {
  it('keeps well-formed charts and defaults the title and top_n', () => {
    const out = parseCharts({ charts: [chart({ title: undefined, top_n: undefined })] }, COLUMNS);
    expect(out).toEqual([{ kind: 'treemap', title: '', group_by: ['country', 'outcome'], top_n: 15 }]);
  });
  it('drops a chart that names a column the index does not have, or one that may not be grouped', () => {
    const out = parseCharts({ charts: [chart({ group_by: ['nope', 'outcome'] }), chart({ group_by: ['user_hash'] }), chart({ group_by: ['total_risk'] }),
      chart({ group_by: ['event_time'] }), chart({ group_by: ['tags'] }), chart({ group_by: ['country'] })] }, COLUMNS);
    expect(out.map((c) => c.group_by)).toEqual([['country']]);
  });
  it('drops an unknown kind, a heat map of one column, a repeated column, and a list of the wrong length', () => {
    const out = parseCharts({ charts: [chart({ kind: 'line' }), chart({ kind: 'heatmap', group_by: ['country'] }), chart({ group_by: ['country', 'country'] }),
      chart({ group_by: [] }), chart({ group_by: ['country', 'outcome', 'port'] }), chart({ kind: 'bar' })] }, COLUMNS);
    expect(out.map((c) => c.kind)).toEqual(['bar']);
  });
  it('clamps top_n into 1..50 and trims and caps the title', () => {
    const [a, b, c] = parseCharts({ charts: [chart({ top_n: 0 }), chart({ top_n: 9999 }), chart({ top_n: 7.9, title: `  ${'x'.repeat(300)}  ` })] }, COLUMNS);
    expect([a?.top_n, b?.top_n, c?.top_n]).toEqual([1, 50, 7]);
    expect(c?.title).toHaveLength(120);
  });
  it('keeps at most four charts', () => {
    expect(parseCharts({ charts: Array.from({ length: 9 }, () => chart()) }, COLUMNS)).toHaveLength(4);
  });
  it('ignores a layout that is not a chart list, whatever it holds', () => {
    for (const layout of [null, undefined, {}, { charts: 'x' }, { charts: [null, 3, 'a', []] }, { viewers: [{ plugin: 'Y Line' }] }]) {
      expect(parseCharts(layout as never, COLUMNS)).toEqual([]);
    }
  });
});

describe('prepareTree', () => {
  it('nests the second column under the first, biggest first, and labels a missing value', () => {
    const t = prepareTree([row('a', 'x', 1), row('a', 'y', 9), row('b', null, 12), row(null, 'x', 2)]);
    expect(t.map((n) => [n.name, n.value])).toEqual([['b', 12], ['a', 10], ['(none)', 2]]);
    expect(t[1]?.children?.map((n) => [n.name, n.value])).toEqual([['y', 9], ['x', 1]]);
    expect(t[0]?.children?.map((n) => n.name)).toEqual(['(none)']);
  });
  it('is flat for one column', () => {
    const t = prepareTree([row('a', undefined, 3), row('b', undefined, 5)]);
    expect(t.map((n) => [n.name, n.value])).toEqual([['b', 5], ['a', 3]]);
  });
  it('neutralises braces in names, which the chart library would read as template syntax', () => {
    expect(prepareTree([row('{c} {b}', undefined, 1)])[0]?.name).not.toContain('{');
  });
});

describe('chart options', () => {
  const rows = [row('a', 'x', 5), row('a', 'y', 3), row('b', 'x', 4)];
  it('a treemap holds the tree and shows group headings only when there are two columns', () => {
    const o = buildTreemapOption(rows) as { series: { type: string; data: unknown[]; upperLabel: { show: boolean } }[] };
    expect(o.series[0]?.type).toBe('treemap');
    expect(o.series[0]?.data).toHaveLength(2);
    expect(o.series[0]?.upperLabel.show).toBe(true);
    expect((buildTreemapOption([row('a', undefined, 1)]) as typeof o).series[0]?.upperLabel.show).toBe(false);
  });
  it('a sunburst holds the same tree, largest first', () => {
    const o = buildSunburstOption(rows) as { series: { type: string; sort: string; data: { name: string }[] }[] };
    expect(o.series[0]).toMatchObject({ type: 'sunburst', sort: 'desc' });
    expect(o.series[0]?.data.map((d) => d.name)).toEqual(['a', 'b']);
  });
  it('ranked bars with two columns stack one series per second value, in order of size', () => {
    const o = buildBarOption(rows, { row: 'A', col: 'B' }) as { yAxis: { data: string[] }; series: { name: string; stack: string; data: number[] }[] };
    expect(o.yAxis.data).toEqual(['a', 'b']);
    expect(o.series.map((s) => [s.name, s.stack, s.data])).toEqual([['x', 'total', [5, 4]], ['y', 'total', [3, 0]]]);
  });
  it('ranked bars with one column are one series', () => {
    const o = buildBarOption([row('a', undefined, 3), row('b', undefined, 5)], { row: 'A' }, 'events') as { series: { name: string; data: number[] }[] };
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ name: 'events', data: [5, 3] });
  });
  it('tooltips escape event data, which is attacker-chosen', () => {
    const o = buildTreemapOption([row('<img src=x onerror=alert(1)>', undefined, 2)]) as { tooltip: { formatter: (p: unknown) => string } };
    const html = o.tooltip.formatter({ name: '<img src=x onerror=alert(1)>', value: 2, treePathInfo: [{ name: '<img src=x onerror=alert(1)>' }] });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    const bar = buildBarOption([row('<b>', undefined, 1)], { row: 'A' }) as { tooltip: { formatter: (i: unknown) => string } };
    expect(bar.tooltip.formatter([{ axisValueLabel: '<script>', seriesName: '<i>', value: 1 }])).not.toMatch(/<script>|<i>/);
  });
});

describe('summarizeChart', () => {
  it('says what is drawn, what is left out, and the largest value', () => {
    const s = summarizeChart('treemap', [row('a', 'x', 5), row('b', 'x', 4)], ['Country', 'Outcome'], 20, true, 'events');
    expect(s).toContain('Country and Outcome');
    expect(s).toContain('9 of 20 events (the most frequent values only)');
    expect(s).toContain('Largest: a, 5.');
  });
  it('says so when there is nothing', () => {
    expect(summarizeChart('bar', [], ['Country'], 0, false, 'records')).toBe('No records in this window.');
  });
});

describe('unfilledDimensions', () => {
  it('names the grouped columns that are empty in every row, and none when the data has some value', () => {
    expect(unfilledDimensions([row(null, 'x', 5), row('', 'y', 3)], 2)).toEqual([0]);
    expect(unfilledDimensions([row(null, null, 5)], 2)).toEqual([0, 1]);
    expect(unfilledDimensions([row('a', null, 5), row(null, 'x', 1)], 2)).toEqual([]);
    expect(unfilledDimensions([], 2)).toEqual([]);
  });
});

describe('colours', () => {
  it('outcomes and severities read as outcomes: allow green, block red, challenge amber, whatever the case', () => {
    expect(colorFor('ALLOW')).toBe(colorFor('allow'));
    expect(colorFor('BLOCK')).toBe(colorFor('denied'));
    expect(new Set([colorFor('allow'), colorFor('block'), colorFor('challenge')]).size).toBe(3);
    expect(colorFor('(none)')).toBe(colorFor('unknown'));
  });
  it('any other value gets the same palette colour every time', () => {
    for (const v of ['US', 'xsoar.example', '203.0.113.9']) {
      expect(PALETTE as readonly string[]).toContain(colorFor(v));
      expect(colorFor(v)).toBe(colorFor(v));
    }
  });
  it('with two columns the second is what is coloured, and it is the same colour in every group', () => {
    const t = prepareTree([row('a', 'block', 1), row('b', 'block', 2), row('b', 'allow', 3)]);
    const colour = (g: string, k: string) => t.find((n) => n.name === g)?.children?.find((c) => c.name === k)?.itemStyle?.color;
    expect(colour('a', 'block')).toBe(colour('b', 'block'));
    expect(colour('b', 'block')).not.toBe(colour('b', 'allow'));
  });
  it('a sunburst colours its inner ring too, so its labels can be read', () => {
    const o = buildSunburstOption([row('GET', 'allow', 3), row('POST', 'block', 1)]) as { series: { data: { name: string; itemStyle: { color: string } }[] }[] };
    for (const d of o.series[0]!.data) expect(d.itemStyle.color).toBe(colorFor(d.name));
    expect((prepareTree([row('a', 'x', 1)])[0] as { itemStyle: { color: string } }).itemStyle.color).toBe('#eef0f2');   // a treemap's group header stays light
  });
  it('bar series take the same colours', () => {
    const o = buildBarOption([row('a', 'block', 1), row('a', 'allow', 2)], { row: 'A', col: 'B' }) as { series: { name: string; itemStyle: { color: string } }[] };
    for (const s of o.series) expect(s.itemStyle.color).toBe(colorFor(s.name));
  });
});

import { describe, expect, it } from 'vitest';
import type { AggregateRow } from '@/lib/vectis-kit/spec';
import { buildHeatmapOption, prepareHeatmap, summarizeHeatmap } from './heatmapOption';

const row = (a: string | null, b: string | null, count: number): AggregateRow => ({ values: [a, b], count });
const ROWS = [row('203.0.113.50', 'block', 60), row('203.0.113.50', 'allow', 10), row('198.51.100.77', 'allow', 40), row('192.0.2.44', null, 5)];

describe('prepareHeatmap', () => {
  it('orders both axes by total count, most frequent first, and indexes the cells', () => {
    const g = prepareHeatmap(ROWS);
    expect(g.rowValues).toEqual(['203.0.113.50', '198.51.100.77', '192.0.2.44']);
    expect(g.colValues).toEqual(['block', 'allow', '(none)']);
  });

  it('puts the busiest column first, and a missing value is labelled, never dropped', () => {
    const g = prepareHeatmap([row('a', 'x', 1), row('a', 'y', 9), row('b', null, 2)]);
    expect(g.colValues).toEqual(['y', '(none)', 'x']);
    expect(g.cells).toContainEqual([g.colValues.indexOf('(none)'), g.rowValues.indexOf('b'), 2]);
  });

  it('keeps every cell count and reports the maximum and the events drawn', () => {
    const g = prepareHeatmap(ROWS);
    expect(g.max).toBe(60);
    expect(g.shown).toBe(115);
    const by = new Map(g.cells.map(([c, r, n]) => [`${g.rowValues[r]}|${g.colValues[c]}`, n]));
    expect(by.get('203.0.113.50|block')).toBe(60);
    expect(by.get('198.51.100.77|allow')).toBe(40);
  });

  it('handles a single grouping column as one column of counts', () => {
    const g = prepareHeatmap([{ values: ['http_activity'], count: 7 }, { values: ['authentication'], count: 3 }]);
    expect(g.colValues).toEqual(['events']);
    expect(g.rowValues).toEqual(['http_activity', 'authentication']);
  });

  it('is empty for no rows', () => {
    const g = prepareHeatmap([]);
    expect(g).toMatchObject({ rowValues: [], colValues: [], cells: [], max: 0, shown: 0 });
  });
});

describe('buildHeatmapOption', () => {
  const opt = (rows = ROWS) => buildHeatmapOption(prepareHeatmap(rows), { row: 'Source IP', col: 'Outcome' }) as unknown as Record<string, any>;

  it('draws a heat map with the largest source at the top and a scale up to the maximum count', () => {
    const o = opt();
    expect(o.series[0].type).toBe('heatmap');
    expect(o.yAxis.inverse).toBe(true);
    expect(o.visualMap.max).toBe(60);
    expect(o.xAxis.name).toBe('Outcome');
    expect(o.yAxis.name).toBe('Source IP');
  });

  it('writes the counts in the cells only while there is room for them', () => {
    expect(opt().series[0].label.show).toBe(true);
    const many = Array.from({ length: 200 }, (_, i) => row(`10.0.0.${i}`, 'allow', 1));
    expect(opt(many).series[0].label.show).toBe(false);
  });

  it('escapes event text in the tooltip and neutralises braces in labels', () => {
    const o = opt([row('<img src=x onerror=alert(1)>', '{{7*7}}', 3)]);
    const html = o.tooltip.formatter({ value: [0, 0, 3] }) as string;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(o.xAxis.data[0]).not.toMatch(/[{}]/);
  });
});

describe('summarizeHeatmap', () => {
  it('says what is drawn, of how many events, and whether it is only the most frequent values', () => {
    const g = prepareHeatmap(ROWS);
    const text = summarizeHeatmap(g, { row: 'Source IP', col: 'Outcome' }, 500, true);
    expect(text).toContain('3 Source IP values by 3 Outcome values');
    expect(text).toContain('115 of 500 events');
    expect(text).toContain('most frequent values only');
    expect(text).toContain('Busiest cell: 203.0.113.50 and block, 60 events');
  });
  it('says so when there is nothing', () => {
    expect(summarizeHeatmap(prepareHeatmap([]), { row: 'a', col: 'b' }, 0, false)).toBe('No events in this window.');
  });
});

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

describe('prepareHeatmap at scale and with hostile names', () => {
  it('indexes 50,000 rows in well under a second (no indexOf per cell)', () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => row(`10.0.${i % 250}.${Math.floor(i / 250) % 250}`, `v${i}`, 1 + (i % 7)));
    const t0 = Date.now();
    const g = prepareHeatmap(rows);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(g.cells).toHaveLength(50_000);
    expect(g.shown).toBe(rows.reduce((n, r) => n + r.count, 0));
    for (const [c, r, n] of g.cells.slice(0, 500)) {
      expect(g.colValues[c]).toBeDefined();
      expect(g.rowValues[r]).toBeDefined();
      expect(n).toBeGreaterThan(0);
    }
  });
  it('keeps cells in first-seen order and merges repeated pairs', () => {
    const g = prepareHeatmap([row('a', 'x', 1), row('b', 'y', 5), row('a', 'x', 2)]);
    expect(g.cells).toEqual([[g.colValues.indexOf('x'), g.rowValues.indexOf('a'), 3], [g.colValues.indexOf('y'), g.rowValues.indexOf('b'), 5]]);
    expect(g.max).toBe(5);
  });
  it('treats __proto__, constructor and a value that looks like JSON as plain names', () => {
    const g = prepareHeatmap([row('__proto__', 'constructor', 4), row('constructor', '["a","b"]', 3), row('toString', null, 2)]);
    expect(g.rowValues.sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(g.colValues.sort()).toEqual(['(none)', '["a","b"]', 'constructor']);
    expect(g.cells).toHaveLength(3);
    expect(g.shown).toBe(9);
    expect(() => buildHeatmapOption(g, { row: 'r', col: 'c' })).not.toThrow();
  });
  it('survives lone surrogates and a very long value', () => {
    const g = prepareHeatmap([row('a' + String.fromCharCode(0xd800), 'x'.repeat(1_000_000), 1)]);
    expect(g.cells).toHaveLength(1);
  });
});

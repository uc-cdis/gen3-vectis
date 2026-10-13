import { describe, expect, it } from 'vitest';
import { sourceMixOption } from './SourceMix';

describe('sourceMixOption', () => {
  it('orders sources by count and keeps counts as numbers', () => {
    const o = sourceMixOption([{ key: 'f5', count: 5 }, { key: 'waf', count: 70 }]) as { yAxis: { data: string[] }; series: Array<{ type: string; data: number[] }> };
    expect(o.yAxis.data).toEqual(['waf', 'f5']);
    expect(o.series[0]).toMatchObject({ type: 'bar', data: [70, 5] });
  });
  it('is empty for no sources and neutralises markup in names', () => {
    expect((sourceMixOption([]) as { series: Array<{ data: number[] }> }).series[0]!.data).toEqual([]);
    const o = sourceMixOption([{ key: '{a|x}', count: 1 }]) as { yAxis: { data: string[] } };
    expect(o.yAxis.data[0]).not.toMatch(/[{}]/);
  });
});

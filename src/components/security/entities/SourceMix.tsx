import React from 'react';
import { List, Text } from '@mantine/core';
import type { ReactEChartsProps } from '@gen3/frontend';
import { ReactECharts } from '@gen3/frontend';
import type { Bucket } from '@/lib/vectis-kit/spec';
import { labelText } from '@/lib/vectis-kit/entity-graph/graphOption';
import { safeText } from '@/lib/safe-text';
import { formatNumber } from '@/lib/vectis-kit/ui/format';

/** Horizontal bar option for the share of events per source. Pure, so it can be tested without drawing. */
export function sourceMixOption(sources: readonly Bucket[]): ReactEChartsProps['option'] {
  const rows = [...sources].sort((a, b) => b.count - a.count).slice(0, 20);
  return {
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => labelText(r.key, 40)) },
    tooltip: { trigger: 'item', formatter: '{b}: {c}' },
    series: [{ type: 'bar', data: rows.map((r) => r.count), label: { show: true, position: 'right' } }],
  };
}

/** Source mix as a bar chart plus the same numbers as text, which is the version assistive technology reads. */
export const SourceMix = ({ sources }: { sources: readonly Bucket[] }) => {
  const total = sources.reduce((s, b) => s + b.count, 0);
  return (
    <div data-testid="source-mix">
      <div aria-hidden="true" style={{ height: Math.max(80, 36 * Math.min(sources.length, 20)) }}>
        <ReactECharts option={sourceMixOption(sources)} theme="gen3" style={{ height: Math.max(80, 36 * Math.min(sources.length, 20)) }} />
      </div>
      <List size="sm" aria-label="Events per source">
        {sources.map((s) => (
          <List.Item key={s.key}>
            <Text span ff="monospace">{safeText(s.key, 60)}</Text>: {formatNumber(s.count)}{total > 0 ? ` (${Math.round((100 * s.count) / total)}%)` : ''}
          </List.Item>
        ))}
      </List>
    </div>
  );
};

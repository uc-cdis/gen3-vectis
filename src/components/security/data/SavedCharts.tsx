import React, { useMemo } from 'react';
import { Paper, SimpleGrid, Table, Text, Title, VisuallyHidden } from '@mantine/core';
import { PanelErrorBoundary, ReactECharts } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { AggregateResponse, ColumnMeta, FilterClause, IndexName, TimeWindow } from '@/lib/vectis-kit/spec';
import { buildBarOption, buildSunburstOption, buildTreemapOption, parseCharts, summarizeChart, unfilledDimensions, type SavedChart } from '@/lib/vectis-kit/timeseries/aggregateCharts';
import { buildHeatmapOption, prepareHeatmap } from '@/lib/vectis-kit/timeseries/heatmapOption';
import { EmptyState, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { formatTime } from '@/lib/vectis-kit/ui/format';

/** Unit word for a count: events for event streams, records for everything else. */
export const unitFor = (category: string | undefined): string => (category === 'events' ? 'events' : 'records');

const TITLES: Record<SavedChart['kind'], string> = { heatmap: 'Heat map', treemap: 'Treemap', sunburst: 'Sunburst', bar: 'Ranked bars' };

/** The saved view's charts. Counts are made in the database over the same window and filters as the table. */
export const SavedCharts = ({ layout, indexName, category, columns, window, filters }: {
  layout: Record<string, unknown> | null;
  indexName: IndexName;
  category?: string;
  columns: readonly ColumnMeta[];
  window: TimeWindow;
  filters: FilterClause[];
}) => {
  const charts = useMemo(() => parseCharts(layout, columns), [layout, columns]);
  if (charts.length === 0) return null;
  const label = (n: string) => columns.find((c) => c.name === n)?.label ?? n;
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" data-testid="saved-charts">
      {charts.map((c, i) => (
        <ChartCard key={`${indexName}:${c.kind}:${c.group_by.join(',')}:${i}`} chart={c} indexName={indexName}
          unit={unitFor(category)} labels={c.group_by.map(label)} window={window} filters={filters}
          wide={charts.length % 2 === 1 && i === 0} />
      ))}
    </SimpleGrid>
  );
};

const ChartCard = ({ chart, indexName, unit, labels, window, filters, wide }: {
  chart: SavedChart; indexName: IndexName; unit: string; labels: string[]; window: TimeWindow; filters: FilterClause[]; wide: boolean;
}) => {
  const query = useSiemQuery('aggregate', { body: { index_name: indexName, window, filters, group_by: chart.group_by, top_n: chart.top_n } });
  const title = chart.title || `${TITLES[chart.kind]}: ${labels.join(' by ')}`;
  return (
    <Paper withBorder p="sm" radius="md" data-testid={`saved-chart-${chart.kind}`} style={{ minWidth: 0, ...(wide ? { gridColumn: '1 / -1' } : {}) }}>
      <Title order={4} size="h5" mb="xs">{title}</Title>
      <QueryBoundary query={query} isEmpty={(d) => d.rows.length === 0}
        empty={<EmptyState title={`No ${unit} to chart`} hint="Nothing matched the window and filters." />}>
        {(d) => (
          // One failing chart must not take down the others or the table.
          <PanelErrorBoundary>
            <ChartBody chart={chart} data={d} unit={unit} labels={labels} title={title} />
          </PanelErrorBoundary>
        )}
      </QueryBoundary>
    </Paper>
  );
};

const ChartBody = ({ chart, data, unit, labels, title }: { chart: SavedChart; data: AggregateResponse; unit: string; labels: string[]; title: string }) => {
  const unfilled = unfilledDimensions(data.rows, chart.group_by.length).map((i) => labels[i] ?? chart.group_by[i]);
  if (unfilled.length > 0) {
    return (
      <div data-testid="chart-unfilled" role="note" style={{ padding: '28px 8px' }}>
        <Text size="sm" fw={600}>{unfilled.join(' and ')} {unfilled.length > 1 ? 'have' : 'has'} no values yet</Text>
        <Text size="xs" c="dimmed" mt={4}>
          None of the {data.total.toLocaleString('en-US')} {unit} in this window carry {unfilled.length > 1 ? 'them' : 'it'}, so there is nothing to chart. It fills in when the source provides it.
        </Text>
      </div>
    );
  }
  const option = useMemo(() => {
    if (chart.kind === 'heatmap') return buildHeatmapOption(prepareHeatmap(data.rows), { row: labels[0] ?? '', col: labels[1] ?? '' });
    if (chart.kind === 'treemap') return buildTreemapOption(data.rows, unit);
    if (chart.kind === 'sunburst') return buildSunburstOption(data.rows, unit);
    return buildBarOption(data.rows, { row: labels[0] ?? '', col: labels[1] }, unit);
  }, [chart.kind, data.rows, labels, unit]);
  const summary = summarizeChart(chart.kind, data.rows, labels, data.total, data.truncated, unit);
  const height = chart.kind === 'bar' ? Math.min(460, Math.max(220, 90 + new Set(data.rows.map((r) => r.values[0])).size * 24)) : 320;
  return (
    <>
      <figure aria-label={`${title}. ${summary}`} style={{ margin: 0 }}>
        <ReactECharts option={option} style={{ height, width: '100%' }} theme="gen3" />
      </figure>
      <VisuallyHidden>{summary}</VisuallyHidden>
      <Text size="xs" c="dimmed">{summary} As of {formatTime(data.as_of)}.</Text>
      <details>
        <summary><Text component="span" size="xs">Show data as a table</Text></summary>
        <Table.ScrollContainer minWidth={300} mah={240}>
          <Table striped withTableBorder aria-label={`${title}, data table`}>
            <Table.Thead>
              <Table.Tr>{labels.map((l) => <Table.Th key={l}>{l}</Table.Th>)}<Table.Th>Count</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.rows.map((r, i) => (
                <Table.Tr key={i}>
                  {labels.map((l, j) => <Table.Td key={l}>{r.values[j] ?? '(none)'}</Table.Td>)}
                  <Table.Td>{r.count}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </details>
    </>
  );
};

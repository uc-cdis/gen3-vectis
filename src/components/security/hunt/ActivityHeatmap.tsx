import React, { useMemo, useState } from 'react';
import { Group, Select, Table, Text, VisuallyHidden } from '@mantine/core';
import { ReactECharts } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { ColumnMeta, FilterClause, IndexName, TimeWindow } from '@/lib/vectis-kit/spec';
import { buildHeatmapOption, prepareHeatmap, summarizeHeatmap } from '@/lib/vectis-kit/timeseries/heatmapOption';
import { EmptyState, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { formatTime } from '@/lib/vectis-kit/ui/format';

/** Columns a heat map can use: not PII, filterable, text-like. */
export const heatmapColumns = (columns: readonly ColumnMeta[]): ColumnMeta[] =>
  columns.filter((c) => !c.pii && c.filterable !== false && (c.type === 'string' || c.type === 'ip' || c.type === 'enum') && c.name !== 'id');

const pick = (cols: readonly ColumnMeta[], prefer: string[], not?: string): string | null =>
  prefer.find((n) => n !== not && cols.some((c) => c.name === n)) ?? cols.find((c) => c.name !== not)?.name ?? null;

export const defaultHeatmapDims = (columns: readonly ColumnMeta[]): { rows: string | null; cols: string | null } => {
  const usable = heatmapColumns(columns);
  const rows = pick(usable, ['src_ip', 'source', 'index_name']);
  return { rows, cols: pick(usable, ['outcome', 'index_name', 'severity', 'activity'], rows ?? undefined) };
};

/** Heat map of event counts by two columns. Counts come from the database over the whole window, not the rows on screen. */
export const ActivityHeatmap = ({ indexName, columns, window, filters }: {
  indexName: IndexName;
  columns: readonly ColumnMeta[];
  window: TimeWindow;
  filters: FilterClause[];
}) => {
  const usable = useMemo(() => heatmapColumns(columns), [columns]);
  const defaults = useMemo(() => defaultHeatmapDims(columns), [columns]);
  const [chosen, setChosen] = useState<{ rows: string | null; cols: string | null }>({ rows: null, cols: null });
  const rowsBy = chosen.rows && usable.some((c) => c.name === chosen.rows) ? chosen.rows : defaults.rows;
  const colsBy = chosen.cols && usable.some((c) => c.name === chosen.cols) ? chosen.cols : defaults.cols;
  const label = (name: string | null) => usable.find((c) => c.name === name)?.label ?? name ?? '';

  const query = useSiemQuery('aggregate', rowsBy && colsBy && rowsBy !== colsBy
    ? { body: { index_name: indexName, window, filters, group_by: [rowsBy, colsBy], top_n: 15 } }
    : null);
  const options = usable.map((c) => ({ value: c.name, label: c.label }));

  return (
    <div data-testid="activity-heatmap">
      <Group align="flex-end" gap="md" mb="xs">
        <Select size="xs" label="Down" w={190} allowDeselect={false} data={options} value={rowsBy}
          onChange={(v) => setChosen((s) => ({ ...s, rows: v }))} />
        <Select size="xs" label="Across" w={190} allowDeselect={false} data={options} value={colsBy}
          onChange={(v) => setChosen((s) => ({ ...s, cols: v }))} />
      </Group>
      {!rowsBy || !colsBy || rowsBy === colsBy ? (
        <EmptyState title="Choose two different columns" hint="The heat map counts events by one column down the side and another across the top." />
      ) : (
        <QueryBoundary query={query} isEmpty={(d) => d.rows.length === 0} empty={<EmptyState title="No events in this window" hint="Nothing matched the window and filters." />}>
          {(d) => <Grid2D data={d} labels={{ row: label(rowsBy), col: label(colsBy) }} />}
        </QueryBoundary>
      )}
    </div>
  );
};

const Grid2D = ({ data, labels }: { data: NonNullable<ReturnType<typeof useSiemQuery<'aggregate'>>['data']>; labels: { row: string; col: string } }) => {
  const grid = useMemo(() => prepareHeatmap(data.rows), [data.rows]);
  const option = useMemo(() => buildHeatmapOption(grid, labels), [grid, labels]);
  const summary = summarizeHeatmap(grid, labels, data.total, data.truncated);
  const height = Math.min(640, Math.max(220, 60 + grid.rowValues.length * 28));
  return (
    <>
      <figure aria-label={`${labels.row} by ${labels.col}. ${summary}`} style={{ margin: 0 }}>
        <ReactECharts option={option} style={{ height, width: '100%' }} theme="gen3" />
      </figure>
      <VisuallyHidden>{summary}</VisuallyHidden>
      <Text size="xs" c="dimmed">
        {summary} As of {formatTime(data.as_of)}.
      </Text>
      <details>
        <summary><Text component="span" size="xs">Show data as a table</Text></summary>
        <Table.ScrollContainer minWidth={300} mah={260}>
          <Table striped withTableBorder aria-label={`${labels.row} by ${labels.col}, data table`}>
            <Table.Thead><Table.Tr><Table.Th>{labels.row}</Table.Th><Table.Th>{labels.col}</Table.Th><Table.Th>Events</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {data.rows.map((r, i) => (
                <Table.Tr key={i}><Table.Td>{r.values[0] ?? '(none)'}</Table.Td><Table.Td>{r.values[1] ?? '(none)'}</Table.Td><Table.Td>{r.count}</Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </details>
    </>
  );
};

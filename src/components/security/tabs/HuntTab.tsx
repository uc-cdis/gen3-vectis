import { withOrigin } from '@/lib/vectis-kit/data-table/origin';
import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { ActionIcon, Badge, Button, Grid, Group, MultiSelect, Select, Stack, Text } from '@mantine/core';
import { SegmentedControl } from '@gen3/frontend';
import { IconX } from '@tabler/icons-react';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { CatalogResponse, Hunt, IndexCatalog, SavedView, QuerySpec } from '@/lib/vectis-kit/spec';
import { RollupChart } from '@/lib/vectis-kit/timeseries/RollupChart';
import type { Grain, TimeRange } from '@/lib/vectis-kit/timeseries/rollupOption';
import { EmptyState, Panel, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { formatNumber, formatTime } from '@/lib/vectis-kit/ui/format';
import { useSecurity } from '../context';
import { FindSimilar } from '../hunt/FindSimilar';
import { ActivityHeatmap } from '../hunt/ActivityHeatmap';
import { RowsTable } from '../hunt/RowsTable';
import { SavedHunts } from '../hunt/SavedHunts';
import { ALL_EVENTS, COLUMN_NAME, EMPTY_VIEW, GRAINS, MAX_GROUP_BY, MAX_ROWS, applySpec, defaultColumns, defaultGroupBy, groupableColumns, huntIndexes, readDeepLink, specFromView, writeDeepLink } from '../hunt/huntModel';
import type { ViewState } from '../hunt/huntModel';
import { isIpAddress } from '@/lib/vectis-kit/spec/indicator';

const DEFAULT_GRAIN: Grain = '5m';

const HuntWorkspace = ({ catalog }: { catalog: CatalogResponse }) => {
  const router = useRouter();
  const { window: consoleWindow, similar } = useSecurity();
  const indexes = huntIndexes(catalog);
  // Index, grain and the brushed range live in the URL so a hunt can be shared as a link.
  const link = readDeepLink(router.query);
  // Start from All events when the catalog has it.
  const index: IndexCatalog = indexes.find((i) => i.index_name === link.index) ?? indexes.find((i) => i.index_name === ALL_EVENTS) ?? (indexes[0] as IndexCatalog);
  const grain = link.grain ?? DEFAULT_GRAIN;
  const range = link.range;

  const [view, setView] = useState<ViewState>(() => ({ ...EMPTY_VIEW, groupBy: defaultGroupBy(index.index_name) }));
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  const navigate = (patch: Parameters<typeof writeDeepLink>[1]) => {
    void router.replace({ pathname: router.pathname, query: writeDeepLink(router.query, patch) }, undefined, { shallow: true });
  };

  const chartWindow = view.chartWindow ?? consoleWindow;
  const groupBy = view.groupBy.filter((g) => COLUMN_NAME.test(g));
  const timeline = useSiemQuery('timeline', {
    body: { window: chartWindow, grain, index_name: index.index_name, ...(groupBy.length ? { group_by: groupBy } : {}), ...(view.filters.length ? { filters: view.filters } : {}) },
  });

  const columns = withOrigin((view.columns ?? defaultColumns(index)).filter((c) => index.columns.some((m) => m.name === c)), index.columns);
  const rowsQuery = useSiemQuery('rows', range ? {
    body: {
      window: range, index_name: index.index_name, columns,
      ...(view.filters.length ? { filters: view.filters } : {}),
      sort: view.sort ?? { field: index.time_field, dir: 'desc' as const },
      paging: { limit: MAX_ROWS },
    },
  } : null);

  const onRange = (r: TimeRange | null) => { setSelectedRow(null); navigate({ range: r }); };

  const changeIndex = (name: string | null) => {
    const next = indexes.find((i) => i.index_name === name);
    if (!next) return;
    setView({ ...EMPTY_VIEW, groupBy: defaultGroupBy(next.index_name) }); setSelectedRow(null);
    navigate({ index: next.index_name, range: null });
  };

  const currentSpec: QuerySpec = specFromView({ index, grain, view, range, consoleWindow });

  const applyToState = (spec: QuerySpec) => {
    const a = applySpec(spec, catalog);
    if (!a) return;
    setView(a.view); setSelectedRow(null);
    navigate({ index: a.index, grain: a.grain ?? grain, range: a.range });
  };
  const onApplyView = (v: SavedView) => applyToState(v.spec);
  const onOpenHunt = (h: Hunt) => applyToState(h.spec);

  const rowMeta = index.columns;
  const selected = selectedRow !== null ? rowsQuery.data?.rows[selectedRow] : undefined;
  const selectedIp = typeof selected?.src_ip === 'string' && isIpAddress(selected.src_ip) ? selected.src_ip : null;
  const [seed, setSeed] = useState<{ type: 'ip'; value: string; n: number } | null>(null);

  return (
    <div data-testid="hunt-tab">
    <Grid gap="md">
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Stack gap="md">
          <Panel title="Unified timeline">
            <Stack gap="sm">
              <Group align="flex-end" gap="md">
                <Select size="xs" label="Index" w={190} allowDeselect={false} value={index.index_name} onChange={changeIndex}
                  data={indexes.map((i) => ({ value: i.index_name, label: `${i.label} (${i.index_name})` }))} />
                <div>
                  <Text size="xs" fw={500} mb={4} id="hunt-grain-label">Grain</Text>
                  <SegmentedControl padding={2} size="xs" aria-labelledby="hunt-grain-label" value={grain} onChange={(v) => navigate({ grain: v as Grain })} data={GRAINS.map((g) => ({ value: g, label: g }))} />
                </div>
                <MultiSelect size="xs" label={`Group by (up to ${MAX_GROUP_BY})`} w={260} maxValues={MAX_GROUP_BY} clearable placeholder={view.groupBy.length ? undefined : 'None'}
                  data={groupableColumns(index)} value={view.groupBy} onChange={(v) => setView({ ...view, groupBy: v.slice(0, MAX_GROUP_BY) })} />
              </Group>
              <QueryBoundary query={timeline} isEmpty={(d) => d.points.length === 0} empty={<EmptyState title="No rollup data in this window" hint="Nothing was recorded for this index in the selected range." />}>
                {(d) => (
                  <>
                    <RollupChart points={d.points} grain={d.grain} label={`${index.label} events over time`} onRangeSelect={onRange} height={320} stacked={groupBy.length > 0} />
                    <Text size="xs" c="dimmed">Read from {d.source === 'rollup' ? 'precomputed rollups' : 'raw events'}, as of {formatTime(d.as_of)}. Drag on the chart to select a time range.</Text>
                  </>
                )}
              </QueryBoundary>
            </Stack>
          </Panel>

          <Panel title="Activity heat map">
            <ActivityHeatmap indexName={index.index_name} columns={index.columns} window={chartWindow} filters={view.filters} />
          </Panel>

          <Panel
            title="Rows"
            action={range ? (
              <Group gap={6}>
                <Badge variant="light" color="gray" data-testid="hunt-range">{formatTime(range.start)} to {formatTime(range.end)}</Badge>
                <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Clear time range" onClick={() => onRange(null)}><IconX size={14} /></ActionIcon>
              </Group>
            ) : undefined}
          >
            {!range ? <EmptyState title="No time range selected" hint="Drag across the timeline to load the raw rows for that range." /> : (
              <Stack gap="xs">
                <QueryBoundary query={rowsQuery} isEmpty={(d) => d.rows.length === 0} empty={<EmptyState title="No rows in this range" />} rows={5}>
                  {(d) => (
                    <>
                      <RowsTable columns={columns} meta={rowMeta} rows={d.rows} selected={selectedRow} onSelect={setSelectedRow} />
                      <Text size="xs" c="dimmed">
                        Showing {formatNumber(d.rows.length)} of {d.total === null || d.total === undefined ? `at least ${formatNumber(d.rows.length)}` : formatNumber(d.total)} rows{d.truncated ? ' (more exist than were loaded)' : ''}.
                      </Text>
                    </>
                  )}
                </QueryBoundary>
                {selectedIp ? (
                  <Group gap="xs">
                    <Text size="sm">Selected row source: {selectedIp}</Text>
                    <Button size="compact-xs" variant="default" onClick={() => setSeed({ type: 'ip', value: selectedIp, n: (seed?.n ?? 0) + 1 })}>Find similar to {selectedIp}</Button>
                  </Group>
                ) : null}
              </Stack>
            )}
          </Panel>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Stack gap="md">
          <FindSimilar key={seed ? `row:${seed.n}` : `ctx:${JSON.stringify(similar)}`} prefill={seed ? { seed } : similar} />
          <SavedViews onApply={onApplyView} applicable={(v) => applySpec(v.spec, catalog) !== null} />
          <SavedHunts currentSpec={currentSpec} onOpen={onOpenHunt} />
        </Stack>
      </Grid.Col>
    </Grid>
    </div>
  );
};

const HuntTab = () => {
  const catalog = useSiemQuery('catalog', {});
  return (
    <QueryBoundary query={catalog} isEmpty={(c) => huntIndexes(c).length === 0} empty={<EmptyState title="No hunting indexes are available" hint="The data catalog lists none of the indexes the unified timeline covers." />}>
      {(c) => <HuntWorkspace catalog={c} />}
    </QueryBoundary>
  );
};
export default HuntTab;

/** Saved views for the hunt. `applicable` hides views for indexes Hunt does not read (those are on the Data page). */
export const SavedViews = ({ onApply, applicable }: { onApply: (view: SavedView) => void; applicable?: (view: SavedView) => boolean }) => {
  const q = useSiemQuery('views', {});
  return (
    <Panel title="Saved views">
      <QueryBoundary query={q} isEmpty={(d) => d.views.filter((v) => !applicable || applicable(v)).length === 0} empty={<EmptyState title="No saved views yet" />} rows={3}>
        {(d) => (
          <Stack gap="sm" component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
            {d.views.filter((v) => !applicable || applicable(v)).map((v) => (
              <li key={v.id}>
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div>
                    <Group gap={6}>
                      <Text fw={500} size="sm">{v.title}</Text>
                      <Badge variant="light" color="gray" size="xs">{v.kind}</Badge>
                      {v.is_default ? <Badge variant="outline" color="gray" size="xs">default</Badge> : null}
                    </Group>
                    <Text size="xs" c="dimmed">{v.spec.index_name}</Text>
                  </div>
                  <Button size="compact-xs" variant="default" onClick={() => onApply(v)} aria-label={`Apply view ${v.title}`}>Apply</Button>
                </Group>
              </li>
            ))}
          </Stack>
        )}
      </QueryBoundary>
    </Panel>
  );
};

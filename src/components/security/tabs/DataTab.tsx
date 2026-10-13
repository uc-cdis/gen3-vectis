import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Group, Select, Stack, Text, ScrollArea, Badge, Button, CloseButton, Paper, SimpleGrid, Checkbox, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconColumns, IconFilter, IconBookmark } from '@tabler/icons-react';
import { NavigationRail } from '@gen3/frontend';
import type { ColumnMeta, FilterClause, IndexName, QuerySpec, SavedView, SortSpec, RowsResponse } from '@/lib/vectis-kit/spec';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { QueryState } from '@/lib/vectis-kit/api/hooks';
import { PerspectiveGrid } from '@/lib/vectis-kit/data-table/PerspectiveGrid';
import { filterKind, keepKnownFields, removeClauseAt, validateClauses, clauseChips } from '@/lib/vectis-kit/data-table/filters';
import { SpecActionsMenu } from '@/lib/vectis-kit/spec-actions/SpecActionsMenu';
import { RANGES, useSecurity } from '../context';
import { EmptyState, QueryBoundary, EntityLink, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { FilterPanel } from '../data/FilterPanel';
import type { FacetInfo } from '../data/FilterPanel';
import { ResultBar } from '../data/ResultBar';
import { formatTime } from '@/lib/vectis-kit/ui/format';

const MAX_FACET_FIELDS = 12;

interface DataState {
  index: IndexName | null;
  /** null = the index's default columns */
  columns: string[] | null;
  filters: FilterClause[];
  sort: SortSpec | null;
  offset: number;
  pageSize: number;
  layout: Record<string, unknown> | null;
  viewId: string | null;
}
const INITIAL: DataState = { index: null, columns: null, filters: [], sort: null, offset: 0, pageSize: 100, layout: null, viewId: null };

const DataBody = ({ catalog }: { catalog: { indexes: { index_name: IndexName; label: string; time_field: string; columns: ColumnMeta[] }[] } }) => {
  const { window, range } = useSecurity();
  const [state, setState] = useState<DataState>(INITIAL);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  // Wide: the rail sits beside the results and stays in view while they scroll. Narrow: it stacks above them, not sticky.
  const wide = useMediaQuery('(min-width: 62em)', true, { getInitialValueInEffect: false }) ?? true;

  const idx = catalog.indexes.find((i) => i.index_name === state.index) ?? catalog.indexes[0];
  const meta = idx?.columns;
  const visible = useMemo(() => {
    if (!meta) return [];
    const wanted = state.columns?.filter((c) => meta.some((m) => m.name === c)) ?? [];
    return wanted.length > 0 ? wanted : defaultColumns(meta);
  }, [meta, state.columns]);

  const patch = useCallback((p: Partial<DataState>, keepView = false) => {
    setSelectedRow(null);
    setState((s) => ({ ...s, offset: 0, ...(keepView ? {} : { viewId: null }), ...p }));
  }, []);

  const validated = validateClauses(state.filters);
  const filtersOk = validated.ok;

  const rowsInput = idx && filtersOk
    ? {
      body: {
        index_name: idx.index_name, window, filters: state.filters, columns: visible,
        ...(state.sort ? { sort: state.sort } : {}),
        paging: { limit: state.pageSize, offset: state.offset },
      },
    }
    : null;
  const rows = useSiemQuery('rows', rowsInput);

  const facetFields = useMemo(() => (meta ?? []).filter((c) => filterKind(c) === 'enum').slice(0, MAX_FACET_FIELDS).map((c) => c.name), [meta]);
  const facets = useSiemQuery(
    'facets',
    idx && filtersOk && facetFields.length > 0 ? { body: { index_name: idx.index_name, fields: facetFields, window, filters: state.filters, top_n: 20 } } : null,
  );
  const facetInfo = useCallback(
    (field: string): FacetInfo => ({
      facet: facets.data?.index_name === idx?.index_name ? facets.data?.facets.find((f) => f.field === field) : undefined,
      loading: facets.loading,
      failed: facets.error !== undefined,
      notes: facets.data?.notes,
    }),
    [facets.data, facets.loading, facets.error, idx?.index_name],
  );

  const spec: QuerySpec | null = idx && filtersOk
    ? { index_name: idx.index_name, window, columns: visible, filters: state.filters, sort: state.sort }
    : null;

  const applyView = (v: SavedView) => {
    const target = catalog.indexes.find((i) => i.index_name === v.spec.index_name);
    if (!target) return;
    const cols = (v.spec.columns ?? []).filter((c) => target.columns.some((m) => m.name === c));
    patch({
      index: target.index_name,
      columns: cols.length > 0 ? cols : null,
      filters: keepKnownFields(v.spec.filters ?? [], target.columns),
      sort: v.spec.sort ?? null,
      layout: v.layout ?? null,
      viewId: v.id,
    }, true);
  };

  const current: QueryState<RowsResponse> = { ...rows, data: rows.data && rows.data.index_name === idx?.index_name ? rows.data : undefined };
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? range;
  const piiShown = (meta ?? []).filter((c) => c.pii && visible.includes(c.name));

  const rail = [
    {
      label: 'Filters', tooltip: 'Filter the table', icon: <IconFilter size={18} />,
      panel: <RailPanel label="Filters" narrow={!wide}><FilterPanel columns={meta ?? []} clauses={state.filters} facets={facetInfo} onChange={(next) => patch({ filters: next })} /></RailPanel>,
    },
    {
      label: 'Columns', tooltip: 'Choose columns', icon: <IconColumns size={18} />,
      panel: <RailPanel label="Columns" narrow={!wide}><ColumnsPanel columns={meta ?? []} visible={visible} onChange={(next) => patch({ columns: next, layout: null })} /></RailPanel>,
    },
    {
      label: 'Views', tooltip: 'Saved views', icon: <IconBookmark size={18} />,
      panel: <RailPanel label="Views" narrow={!wide}><ViewsPanel activeId={state.viewId} onApply={applyView} /></RailPanel>,
    },
  ];

  return (
    <Stack gap="sm" data-testid="data-tab">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Select
          size="xs" w={220} label="Index" allowDeselect={false}
          value={idx?.index_name ?? null}
          data={catalog.indexes.map((i) => ({ value: i.index_name, label: i.label }))}
          onChange={(v) => {
            const next = catalog.indexes.find((i) => i.index_name === v);
            if (next) patch({ index: next.index_name, columns: null, filters: [], sort: null, layout: null });
          }}
        />
        <Group gap="xs" align="center">
          <SpecActionsMenu spec={spec} rows={rows.data?.rows ?? []} timeField={idx?.time_field} />
        </Group>
      </Group>

      <QueryChips
        rangeLabel={rangeLabel}
        indexLabel={idx?.label ?? ''}
        filters={state.filters}
        columns={meta ?? []}
        onRemove={(i) => patch({ filters: removeClauseAt(state.filters, i) })}
        onClear={() => patch({ filters: [] })}
      />
      {!validated.ok ? (
        <Alert color="orange" variant="light" title="This query is not being run" role="alert" data-testid="filter-limit">{validated.error}</Alert>
      ) : null}
      {piiShown.length > 0 ? (
        <Alert color="gray" variant="outline" py={6} data-testid="pii-notice">
          <Text size="xs">
            Personal-data (PII) columns are shown: {piiShown.map((c) => c.label).join(', ')}. What you see depends on your permissions. Take care when copying or exporting.
          </Text>
        </Alert>
      ) : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: wide ? 'nowrap' : 'wrap' }} data-testid="data-layout">
        <div
          data-testid="filter-rail"
          style={wide ? { position: 'sticky', top: 8, flex: '0 0 360px', zIndex: 1 } : { flex: '1 1 100%', minWidth: 0 }}
        >
          <NavigationRail items={rail} label="Explore" width={wide ? 360 : 320} />
        </div>
        <div style={{ flex: '1 1 0', minWidth: wide ? 0 : '100%' }}>
          <Stack gap="sm">
            {!filtersOk ? (
              <EmptyState title="Nothing to show yet" hint="Remove some filters so the query can run." />
            ) : (
              <QueryBoundary
                query={current}
                isEmpty={(d) => d.rows.length === 0 && state.offset === 0}
                empty={
                  <EmptyState
                    title="No rows in this window"
                    hint={state.filters.length > 0 ? 'No rows match these filters. Remove a filter chip to widen the query.' : 'Try a longer time range.'}
                  />
                }
              >
                {(d) => (
                  <>
                    <ResultBar
                      offset={state.offset}
                      shown={d.rows.length}
                      total={d.total}
                      hasMore={d.truncated || (d.total !== null && d.total !== undefined ? state.offset + d.rows.length < d.total : d.rows.length >= state.pageSize)}
                      pageSize={state.pageSize}
                      sortable={(meta ?? []).filter((c) => c.sortable !== false && visible.includes(c.name))}
                      sort={state.sort}
                      asOf={d.as_of}
                      version={d.source_version}
                      updating={rows.stale}
                      onPage={(o) => { setSelectedRow(null); setState((s) => ({ ...s, offset: o })); }}
                      onPageSize={(n) => patch({ pageSize: n }, true)}
                      onSort={(s) => patch({ sort: s }, true)}
                    />
                    <PerspectiveGrid
                      columns={d.columns}
                      rows={d.rows}
                      meta={meta ?? []}
                      layout={state.layout}
                      sort={state.sort}
                      onSortChange={(s) => patch({ sort: s }, true)}
                      onRowClick={setSelectedRow}
                      label={`${idx?.label ?? 'Data'} table`}
                    />
                  </>
                )}
              </QueryBoundary>
            )}
            {selectedRow ? <RowDetail row={selectedRow} columns={visible} meta={meta ?? []} onClose={() => setSelectedRow(null)} /> : null}
          </Stack>
        </div>
      </div>
    </Stack>
  );
};

/** The raw table: filter rail, query chips, count and a Perspective grid, all generated from the catalog. */
const DataTab = () => {
  const catalog = useSiemQuery('catalog', {});
  return (
    <QueryBoundary query={catalog} isEmpty={(d) => d.indexes.length === 0} empty={<EmptyState title="No data sources" hint="The catalog lists no indexes you can read." />}>
      {(d) => <DataBody catalog={d} />}
    </QueryBoundary>
  );
};

export default DataTab;

/** Tallest a rail panel gets: the viewport less the page chrome above it, so the panel scrolls itself and the page does not. */
const RAIL_PANEL_MAX_HEIGHT = 'calc(100dvh - 190px)';
/** On a narrow screen the rail is stacked above the results, so it must stay short enough to leave them in view. */
const RAIL_PANEL_MAX_HEIGHT_NARROW = '340px';

/**
 * A rail panel that scrolls on its own. The scroll area is focusable and named, so a keyboard user can reach it with Tab and
 * scroll it with the arrow keys; tab order inside is then the panel's own controls, top to bottom.
 */
export const RailPanel = ({ label, narrow = false, children }: { label: string; narrow?: boolean; children: React.ReactNode }) => (
  <ScrollArea.Autosize
    mah={narrow ? RAIL_PANEL_MAX_HEIGHT_NARROW : RAIL_PANEL_MAX_HEIGHT} type="auto" offsetScrollbars scrollbarSize={8}
    viewportProps={{ tabIndex: 0, role: 'region', 'aria-label': label }} data-testid="rail-panel"
  >
    {children}
  </ScrollArea.Autosize>
);

/** The query in words: the fixed time range, then one removable chip per active filter. */
export const QueryChips = ({
  rangeLabel, indexLabel, filters, columns, onRemove, onClear,
}: {
  rangeLabel: string;
  indexLabel: string;
  filters: readonly FilterClause[];
  columns: readonly ColumnMeta[];
  onRemove: (index: number) => void;
  onClear: () => void;
}) => {
  const chips = clauseChips(filters, columns);
  return (
    <Group gap="xs" align="center" data-testid="query-chips" role="group" aria-label="Active query">
      <Badge variant="light" color="gray" radius="sm" size="lg" tt="none">{indexLabel}</Badge>
      <Badge variant="light" color="gray" radius="sm" size="lg" tt="none">Time: {rangeLabel}</Badge>
      {chips.map((c, i) => (
        <Group key={c.key} gap={4} wrap="nowrap" px="xs" py={2} data-testid="filter-chip" style={{ border: '1px solid var(--mantine-color-gray-4)', borderRadius: 16 }}>
          <Text size="sm">{c.label}</Text>
          <CloseButton size="sm" aria-label={`Remove filter: ${c.label}`} onClick={() => onRemove(i)} />
        </Group>
      ))}
      {chips.length === 0 ? <Text size="sm" c="gray.7">No filters. Use the Filters panel to narrow the table.</Text> : null}
      {chips.length > 1 ? <Button variant="subtle" size="compact-sm" onClick={onClear}>Clear all</Button> : null}
    </Group>
  );
};

const show = (v: unknown, col: ColumnMeta | undefined): React.ReactNode => {
  if (v === null || v === undefined) return <Unmeasured reason="This row has no value here." />;
  if (col?.type === 'timestamp' && typeof v === 'string') return formatTime(v);
  if (col?.type === 'ip' && typeof v === 'string' && v !== '') return <EntityLink type="ip" value={v} />;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

/** One clicked row, field by field. Address cells open the entity drawer through EntityLink. Everything is text. */
export const RowDetail = ({ row, columns, meta, onClose }: { row: Record<string, unknown>; columns: readonly string[]; meta: readonly ColumnMeta[]; onClose: () => void }) => {
  const byName = new Map(meta.map((m) => [m.name, m]));
  return (
    <Paper withBorder p="sm" radius="md" data-testid="row-detail" role="region" aria-label="Selected row">
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">Selected row</Text>
        <Button size="compact-xs" variant="subtle" onClick={onClose}>Close</Button>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
        {columns.map((name) => {
          const col = byName.get(name);
          return (
            <div key={name}>
              <Group gap={6}>
                <Text size="xs" c="gray.7">{col?.label ?? name}</Text>
                {col?.pii ? <Badge size="xs" color="red" variant="outline" radius="sm">PII</Badge> : null}
              </Group>
              <Text size="sm" component="div" style={{ wordBreak: 'break-all' }}>{show(row[name], col)}</Text>
            </div>
          );
        })}
      </SimpleGrid>
    </Paper>
  );
};

/** Saved views from the service. Applying one sets index, columns, filters and sort; the time range stays as chosen. */
export const ViewsPanel = ({ activeId, onApply }: { activeId: string | null; onApply: (view: SavedView) => void }) => {
  const views = useSiemQuery('views', {});
  return (
    <QueryBoundary query={views} isEmpty={(d) => d.views.length === 0} empty={<EmptyState title="No saved views" hint="Views saved by you or shared with you will appear here." />} rows={3}>
      {(d) => (
        <Stack gap="xs" role="list" aria-label="Saved views">
          <Text size="xs" c="gray.7">Applying a view keeps the time range you have chosen.</Text>
          {d.views.map((v) => (
            <div key={v.id} role="listitem">
              <Button
                fullWidth
                variant={activeId === v.id ? 'filled' : 'light'}
                color={activeId === v.id ? undefined : 'gray'}
                justify="space-between"
                h="auto"
                py={6}
                aria-pressed={activeId === v.id}
                onClick={() => onApply(v)}
                rightSection={<Badge size="xs" variant="outline" radius="sm" color={activeId === v.id ? 'white' : 'gray'}>{v.kind}</Badge>}
              >
                <Stack gap={0} align="flex-start" style={{ whiteSpace: 'normal', textAlign: 'left' }}>
                  <Text size="sm" fw={600} inherit>{v.title}</Text>
                  {v.description ? <Text size="xs" inherit opacity={0.8}>{v.description}</Text> : null}
                </Stack>
              </Button>
            </div>
          ))}
        </Stack>
      )}
    </QueryBoundary>
  );
};

const MAX_COLUMNS = 60;
export const defaultColumns = (cols: readonly ColumnMeta[]): string[] => {
  const d = cols.filter((c) => c.default_visible).map((c) => c.name);
  return (d.length > 0 ? d : cols.slice(0, 8).map((c) => c.name)).slice(0, MAX_COLUMNS);
};

/** Column picker generated from the catalog. Order follows the catalog; PII columns are marked in text. */
export const ColumnsPanel = ({ columns, visible, onChange }: { columns: readonly ColumnMeta[]; visible: readonly string[]; onChange: (next: string[]) => void }) => {
  const set = new Set(visible);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const listed = q ? columns.filter((c) => c.label.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : columns;
  const toggle = (name: string, on: boolean) => {
    const next = columns.map((c) => c.name).filter((n) => (n === name ? on : set.has(n)));
    if (next.length === 0 || next.length > MAX_COLUMNS) return;
    onChange(next);
  };
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Button size="compact-xs" variant="default" onClick={() => onChange(defaultColumns(columns))}>Default columns</Button>
        <Button size="compact-xs" variant="default" onClick={() => onChange(columns.slice(0, MAX_COLUMNS).map((c) => c.name))}>
          {columns.length > MAX_COLUMNS ? `First ${MAX_COLUMNS}` : 'All columns'}
        </Button>
      </Group>
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--mantine-color-body)', paddingBottom: 6 }}>
        <TextInput size="xs" aria-label="Find a column" placeholder={`Find a column by name (${columns.length})`} value={query} maxLength={64} onChange={(e) => setQuery(e.currentTarget.value)} />
        <Text size="xs" c="gray.7" mt={4}>{visible.length} of {columns.length} shown. At least one column is always shown.</Text>
      </div>
      {listed.length === 0 ? <Text size="sm" c="gray.7" role="status">No column is named like that.</Text> : null}
      <Stack gap={4} role="group" aria-label="Columns">
        {listed.map((c) => (
          <Checkbox
            key={c.name}
            size="xs"
            checked={set.has(c.name)}
            disabled={(set.size === 1 && set.has(c.name)) || (!set.has(c.name) && set.size >= MAX_COLUMNS)}
            onChange={(e) => toggle(c.name, e.currentTarget.checked)}
            label={
              <Group gap={6} wrap="nowrap">
                <span title={c.description}>{c.label}</span>
                {c.pii ? <Badge size="xs" color="red" variant="outline" radius="sm" title="Personal data. What you can see is decided by your permissions.">PII</Badge> : null}
              </Group>
            }
          />
        ))}
      </Stack>
    </Stack>
  );
};

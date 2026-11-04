import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { ActionIcon, Alert, Group, Select, Stack, Text, ScrollArea, Badge, Button, CloseButton, Paper, SimpleGrid, Checkbox, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconColumns, IconFilter, IconBookmark, IconX } from '@tabler/icons-react';
import { NavigationRail } from '@gen3/frontend';
import type { ColumnMeta, FilterClause, IndexName, QuerySpec, SavedView, SortSpec, RowsResponse, TimeWindow } from '@/lib/vectis-kit/spec';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { QueryState } from '@/lib/vectis-kit/api/hooks';
import { PerspectiveGrid } from '@/lib/vectis-kit/data-table/PerspectiveGrid';
import { isOriginColumn, withOrigin } from '@/lib/vectis-kit/data-table/origin';
import { filterKind, keepKnownFields, removeClauseAt, validateClauses, clauseChips } from '@/lib/vectis-kit/data-table/filters';
import { SpecActionsMenu } from '@/lib/vectis-kit/spec-actions/SpecActionsMenu';
import { RANGES, useSecurity } from '../context';
import { EmptyState, QueryBoundary, EntityLink, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { FilterPanel } from '../data/FilterPanel';
import type { FacetInfo } from '../data/FilterPanel';
import { ResultBar } from '../data/ResultBar';
import { SavedCharts } from '../data/SavedCharts';
import { formatTime } from '@/lib/vectis-kit/ui/format';
import { ExpandableText } from '@/lib/vectis-kit/ui/ExpandableText';
import { TextMetaNote, textMetaOf } from '../data/TextMetaNote';
import { DRS_FIELDS, SHOW_DRS_EVIDENCE } from '@/lib/vectis-kit/spec-actions/drs';
import { describeFilter, filtersForIndex, readDeepLink, readLinkIndex, writeDeepLink } from '../hunt/huntModel';
import { readDataView, sameDataView, writeDataView } from '../data/dataViewState';
import { investigationFromRow, writeContextLink } from '../hunt/contextModel';
import { LOOK_BACK_HOURS, machineSessionsLink } from '../data/machineAttribution';

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

const CATEGORY_LABEL: Record<string, string> = { events: 'Events', findings: 'Findings', entities: 'Entities', threat_intel: 'Threat intelligence' };
const categoryLabel = (key: string): string => (Object.hasOwn(CATEGORY_LABEL, key) ? (CATEGORY_LABEL[key] as string) : key);

/** Index picker options, grouped by category. */
export const indexOptions = (indexes: readonly { index_name: string; label: string; category?: string }[]) => {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const i of indexes) {
    const key = i.category ?? 'events';
    groups.set(key, [...(groups.get(key) ?? []), { value: i.index_name, label: i.label }]);
  }
  return [...groups.entries()].map(([key, items]) => ({ group: categoryLabel(key), items }));
};

const DataBody = ({ catalog }: { catalog: { indexes: { index_name: IndexName; label: string; category?: string; time_field: string; columns: ColumnMeta[] }[] } }) => {
  const { window: consoleWindow, range } = useSecurity();
  const router = useRouter();
  // An index, window and filters carried in the URL (from an alert or Hunt) are applied here and cleared with their badges.
  const linkKey = JSON.stringify([router.query.hunt_index, router.query.hunt_from, router.query.hunt_to, router.query.hunt_filters]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- linkKey is the content of the query values read inside
  const link = useMemo(() => readDeepLink(router.query), [linkKey]);
  const namedIndex = readLinkIndex(router.query);
  const linkIndex = namedIndex !== null && catalog.indexes.some((i) => i.index_name === namedIndex) ? namedIndex : null;
  // A link naming an index this user cannot read is ignored whole: its window and filters mean nothing on another index.
  const linkUsable = router.query.hunt_index === undefined || linkIndex !== null;
  const window = (linkUsable ? link.range : null) ?? consoleWindow;
  const [state, setState] = useState<DataState>(INITIAL);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  // Wide: the rail sits beside the results and stays in view while they scroll. Narrow: it stacks above them, not sticky.
  const wide = useMediaQuery('(min-width: 62em)', true, { getInitialValueInEffect: false }) ?? true;

  const idx = catalog.indexes.find((i) => i.index_name === (linkIndex ?? state.index)) ?? catalog.indexes[0];
  const meta = useMemo(() => (SHOW_DRS_EVIDENCE ? idx?.columns : idx?.columns.filter((c) => !DRS_FIELDS.has(c.name))), [idx]);
  const linkFilters = useMemo(() => (linkUsable && meta ? filtersForIndex(link.filters, { columns: meta }) : []), [link, linkUsable, meta]);
  const linkRange = linkUsable ? link.range : null;
  const clearLink = (what: { index?: null; range?: null; filters?: null }) => {
    void router.replace({ pathname: router.pathname, query: writeDeepLink(router.query, what) }, undefined, { shallow: true });
  };
  const visible = useMemo(() => {
    if (!meta) return [];
    const wanted = state.columns?.filter((c) => meta.some((m) => m.name === c)) ?? [];
    return withOrigin(wanted.length > 0 ? wanted : defaultColumns(meta), meta);
  }, [meta, state.columns]);

  const patch = useCallback((p: Partial<DataState>, keepView = false) => {
    setSelectedRow(null);
    setState((s) => ({ ...s, offset: 0, ...(keepView ? {} : { viewId: null }), ...p }));
  }, []);

  // The link's filters and the rail's both apply, so the table, facets, counts and exports match what the badges say.
  const filters = useMemo(() => [...linkFilters, ...state.filters], [linkFilters, state.filters]);
  const validated = validateClauses(filters);
  const filtersOk = validated.ok;

  const rowsInput = idx && filtersOk
    ? {
      body: {
        index_name: idx.index_name, window, filters, columns: withId(visible, meta),
        ...(state.sort ? { sort: state.sort } : {}),
        paging: { limit: state.pageSize, offset: state.offset },
      },
    }
    : null;
  const rows = useSiemQuery('rows', rowsInput);

  const facetFields = useMemo(() => (meta ?? []).filter((c) => filterKind(c) === 'enum').slice(0, MAX_FACET_FIELDS).map((c) => c.name), [meta]);
  const facets = useSiemQuery(
    'facets',
    idx && filtersOk && facetFields.length > 0 ? { body: { index_name: idx.index_name, fields: facetFields, window, filters, top_n: 20 } } : null,
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
    ? { index_name: idx.index_name, window, columns: visible, filters, sort: state.sort }
    : null;

  const applyView = (v: SavedView, query: typeof router.query = router.query) => {
    const target = catalog.indexes.find((i) => i.index_name === v.spec.index_name);
    if (!target) return;
    const cols = (v.spec.columns ?? []).filter((c) => target.columns.some((m) => m.name === c));
    void router.replace({ pathname: router.pathname, query: writeDeepLink(query, { index: null, range: null, filters: null }) }, undefined, { shallow: true });
    patch({
      index: target.index_name,
      columns: cols.length > 0 ? cols : null,
      filters: keepKnownFields(v.spec.filters ?? [], target.columns),
      sort: v.spec.sort ?? null,
      layout: v.layout ?? null,
      viewId: v.id,
    }, true);
  };

  // Opened from the Views tab (?view=<id>): apply that view once, then drop the parameter so a later change is not undone by a re-render.
  const viewParam = Array.isArray(router.query.view) ? router.query.view[0] : router.query.view;
  const [pendingLayout, setPendingLayout] = useState<string | null>(null);
  const savedViews = useSiemQuery('views', viewParam || pendingLayout ? {} : null);
  useEffect(() => {
    if (!viewParam || !savedViews.data) return;
    const { view: _drop, ...rest } = router.query;
    const v = savedViews.data.views.find((x) => x.id === viewParam);
    if (v) applyView(v, rest);
    else void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the views arrive for a ?view= link
  }, [viewParam, savedViews.data]);

  // The analyst's own working state lives in the URL (d_*): restored once on arrival, then written back as it changes, so a
  // refresh or a copied link returns to the same table. A link from an alert, Hunt, an Overview tile or the Views tab
  // (hunt_index, view) is an explicit instruction and wins over what was remembered.
  const [stateReady, setStateReady] = useState(false);
  useEffect(() => {
    if (stateReady || !router.isReady) return;
    const asked = router.query.hunt_index !== undefined || router.query.view !== undefined;
    const remembered = asked ? null : readDataView(router.query);
    const target = remembered?.index ? catalog.indexes.find((i) => i.index_name === remembered.index) : undefined;
    if (remembered && target) {
      const known = (c: string) => target.columns.some((m) => m.name === c);
      const columns = (remembered.columns ?? []).filter(known);
      setState({
        ...INITIAL,
        index: target.index_name,
        columns: columns.length > 0 ? columns : null,
        filters: keepKnownFields(remembered.filters, target.columns),
        sort: remembered.sort && known(remembered.sort.field) ? remembered.sort : null,
        viewId: remembered.viewId,
      });
      if (remembered.viewId) setPendingLayout(remembered.viewId);
    }
    setStateReady(true);
  }, [stateReady, router.isReady, router.query, catalog.indexes]);
  useEffect(() => {
    if (!stateReady) return;
    const next = writeDataView(router.query, { index: state.index, columns: state.columns, filters: state.filters, sort: state.sort, viewId: state.viewId });
    if (sameDataView(router.query, next)) return;
    void router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- written when the view changes, not when the URL does
  }, [stateReady, state.index, state.columns, state.filters, state.sort, state.viewId]);
  // A remembered saved view brings its charts back once the views arrive.
  useEffect(() => {
    if (!pendingLayout || !savedViews.data) return;
    const v = savedViews.data.views.find((x) => x.id === pendingLayout);
    setPendingLayout(null);
    if (v) setState((cur) => (cur.viewId === pendingLayout ? { ...cur, layout: v.layout ?? null } : cur));
  }, [pendingLayout, savedViews.data]);

  const current: QueryState<RowsResponse> = { ...rows, data: rows.data && rows.data.index_name === idx?.index_name ? rows.data : undefined };
  // Reference data has no event time, so the time range does not apply.
  const rangeLabel = idx?.category === 'threat_intel' ? 'Not applied (reference data)'
    : linkRange ? `${formatTime(linkRange.start)} to ${formatTime(linkRange.end)}` : (RANGES.find((r) => r.id === range)?.label ?? range);
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
          data={indexOptions(catalog.indexes)}
          onChange={(v) => {
            const next = catalog.indexes.find((i) => i.index_name === v);
            if (!next) return;
            clearLink({ index: null, range: null, filters: null });
            patch({ index: next.index_name, columns: null, filters: [], sort: null, layout: null });
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
      {linkRange || linkFilters.length > 0 ? (
        <Group gap="xs" align="center" data-testid="link-applied">
          {linkRange ? (
            <Group gap={4} wrap="nowrap">
              <Badge variant="light" color="gray" radius="sm" size="lg" tt="none" data-testid="link-range">Window: {formatTime(linkRange.start)} to {formatTime(linkRange.end)}</Badge>
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Clear the time window and use the console range" onClick={() => clearLink({ range: null })}><IconX size={14} /></ActionIcon>
            </Group>
          ) : null}
          {linkFilters.length > 0 ? (
            <Group gap={4} wrap="nowrap">
              <Badge variant="light" color="blue" radius="sm" size="lg" tt="none" data-testid="link-filters" style={{ whiteSpace: 'normal', height: 'auto' }}>Filters: {linkFilters.map(describeFilter).join('; ')}</Badge>
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Clear the linked filters" onClick={() => clearLink({ filters: null })}><IconX size={14} /></ActionIcon>
            </Group>
          ) : null}
        </Group>
      ) : null}
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
            {filtersOk && idx && state.layout ? (
              <SavedCharts layout={state.layout} indexName={idx.index_name} category={idx.category} columns={meta ?? []} window={window} filters={filters} />
            ) : null}
            {!filtersOk ? (
              <EmptyState title="Nothing to show yet" hint="Remove some filters so the query can run." />
            ) : (
              <QueryBoundary
                query={current}
                isEmpty={(d) => d.rows.length === 0 && state.offset === 0}
                empty={
                  <EmptyState
                    title="No rows in this window"
                    hint={filters.length > 0 ? 'No rows match these filters. Remove a filter chip to widen the query.' : 'Try a longer time range.'}
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
            {selectedRow ? <RowDetail row={selectedRow} columns={visible} meta={meta ?? []} onClose={() => setSelectedRow(null)} full={idx ? { index: idx.index_name, window } : undefined} /> : null}
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
  let text: string;
  try { text = typeof v === 'object' ? JSON.stringify(v) ?? '' : String(v); } catch { text = '[unreadable]'; }
  // A long value is previewed with its true length and opens in place; hidden characters are shown as <U+XXXX>.
  return <ExpandableText value={text} previewChars={500} label={col?.label ?? 'value'} />;
};

const MAX_REQUEST_COLUMNS = 60; // what one rows request may name
const FULL_ROW_CHUNKS = 5; // 300 columns, the most an index declares

/** The columns plus the event's id and time, when the index has them, so a clicked row can be asked for in full without scanning the whole range. */
const withId = (columns: readonly string[], meta: readonly ColumnMeta[] | undefined): string[] =>
  ['id', 'event_time'].reduce((all, name) => (all.includes(name) || !meta?.some((m) => m.name === name) ? all : [...all, name]), [...columns]);

const AROUND_MS = 60_000;
/** A minute either side of the event: ids are random, so the time is what lets the store skip every other file. The whole range when the row has no usable time. */
const narrowWindow = (time: unknown, whole: TimeWindow): TimeWindow => {
  const at = typeof time === 'string' ? Date.parse(time) : Number.NaN;
  return Number.isFinite(at) ? { start: new Date(at - AROUND_MS).toISOString(), end: new Date(at + AROUND_MS).toISOString() } : whole;
};

/** Every column of the event a row came from, read when asked for (an index has too many to read for every row). Empty ones are counted, not listed. */
const FullRow = ({ id, time, index, window, meta }: { id: string; time: unknown; index: IndexName; window: TimeWindow; meta: readonly ColumnMeta[] }) => {
  const around = narrowWindow(time, window);
  const names = meta.map((m) => m.name);
  const chunk = (i: number) => names.slice(i * MAX_REQUEST_COLUMNS, (i + 1) * MAX_REQUEST_COLUMNS);
  const ask = (i: number) => (chunk(i).length > 0
    ? { body: { index_name: index, window: around, filters: [{ field: 'id', op: 'eq' as const, value: id }], columns: chunk(i), paging: { limit: 1, offset: 0 } } }
    : null);
  // a fixed number of requests (hooks cannot be conditional); an empty slice asks nothing
  const parts = [useSiemQuery('rows', ask(0)), useSiemQuery('rows', ask(1)), useSiemQuery('rows', ask(2)), useSiemQuery('rows', ask(3)), useSiemQuery('rows', ask(4))];
  const used = parts.filter((_, i) => chunk(i).length > 0);
  const failed = used.find((q) => q.error !== undefined);
  if (failed) return <Text size="sm" c="red" role="alert">The full event could not be read: {String((failed.error as { message?: string })?.message ?? 'request failed')}</Text>;
  if (used.some((q) => !q.data)) return <Text size="sm" c="dimmed">Reading every field...</Text>;
  const found = used.map((q) => q.data?.rows[0] ?? null);
  if (found.some((r) => r === null)) return <Text size="sm" c="dimmed">The full event is no longer in the time range, so it cannot be read again.</Text>;
  const row = Object.assign({}, ...found) as Record<string, unknown>;
  const byName = new Map(meta.map((m) => [m.name, m]));
  const filled = names.filter((n) => row[n] !== null && row[n] !== undefined && row[n] !== '');
  return (
    <div data-testid="full-row">
      <Text size="xs" c="dimmed" mb={4}>{filled.length} fields have a value; {names.length - filled.length} are empty for this event.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
        {filled.map((name) => {
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
    </div>
  );
};

/** One clicked row, field by field. Address cells open the entity drawer through EntityLink. Everything is text. */
export const RowDetail = ({ row, columns, meta, onClose, full }: { row: Record<string, unknown>; columns: readonly string[]; meta: readonly ColumnMeta[]; onClose: () => void; full?: { index: IndexName; window: TimeWindow } }) => {
  const { goTab } = useSecurity();
  const [everyField, setEveryField] = useState(false);
  const id = typeof row.id === 'string' && row.id !== '' ? row.id : null;
  const byName = new Map(meta.map((m) => [m.name, m]));
  const investigation = investigationFromRow(row, meta);
  const onMachine = machineSessionsLink(row);
  return (
    <Paper withBorder p="sm" radius="md" data-testid="row-detail" role="region" aria-label="Selected row">
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">Selected row</Text>
        <Group gap="xs">
          {investigation ? <Button size="compact-xs" variant="default" onClick={() => goTab('hunt', writeContextLink({}, investigation))}>Investigate in Hunt</Button> : null}
          {onMachine ? (
            <Button
              size="compact-xs" variant="default" title={`Session Manager sessions on this machine in the ${LOOK_BACK_HOURS} hours before this event`}
              onClick={() => goTab('data', { ...onMachine, d_index: undefined, d_cols: undefined, d_filters: undefined, d_sort: undefined, d_view: undefined })}
            >
              Who was on this machine?
            </Button>
          ) : null}
          {full && id ? <Button size="compact-xs" variant="default" aria-pressed={everyField} onClick={() => setEveryField((v) => !v)}>{everyField ? 'Show fewer fields' : 'Show every field'}</Button> : null}
          <Button size="compact-xs" variant="subtle" onClick={onClose}>Close</Button>
        </Group>
      </Group>
      {everyField && full && id ? <FullRow id={id} time={row.event_time} index={full.index} window={full.window} meta={meta} /> : null}
      {everyField ? null : <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
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
      </SimpleGrid>}
      <TextMetaNote value={textMetaOf(row)} />
    </Paper>
  );
};

/** Saved views from the service. Applying one sets index, columns, filters and sort; the time range stays as chosen. */
export const ViewsPanel = ({ activeId, onApply }: { activeId: string | null; onApply: (view: SavedView) => void }) => {
  const views = useSiemQuery('views', {});
  const catalog = useSiemQuery('catalog', {});
  const categoryOf = (indexName: string) => catalog.data?.indexes.find((i) => i.index_name === indexName)?.category ?? 'events';
  return (
    <QueryBoundary query={views} isEmpty={(d) => d.views.length === 0} empty={<EmptyState title="No saved views" hint="Views saved by you or shared with you will appear here." />} rows={3}>
      {(d) => {
        const groups = new Map<string, SavedView[]>();
        for (const v of d.views) {
          const key = categoryOf(v.spec.index_name);
          groups.set(key, [...(groups.get(key) ?? []), v]);
        }
        const ordered = [...groups.entries()].sort((a, b) => Object.keys(CATEGORY_LABEL).indexOf(a[0]) - Object.keys(CATEGORY_LABEL).indexOf(b[0]));
        return (
          <Stack gap="md" role="list" aria-label="Saved views">
            <Text size="xs" c="gray.7">Applying a view keeps the time range you have chosen.</Text>
            {ordered.map(([key, items]) => (
              <Stack gap={6} key={key}>
                <Text size="xs" fw={700} tt="uppercase" c="gray.7" style={{ letterSpacing: 0.6 }}>{categoryLabel(key)}</Text>
                {items.map((v) => (
                  <div key={v.id} role="listitem">
                    <Button
                      fullWidth
                      variant={activeId === v.id ? 'filled' : 'light'}
                      color={activeId === v.id ? undefined : 'gray'}
                      justify="flex-start"
                      h="auto"
                      py={8}
                      px={10}
                      aria-pressed={activeId === v.id}
                      onClick={() => onApply(v)}
                      styles={{ label: { whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.4 } }}
                    >
                      <Stack gap={2} align="flex-start">
                        <Text size="sm" fw={600} inherit lh={1.3}>{v.title}</Text>
                        {v.description ? <Text size="xs" fw={400} inherit opacity={0.8} lh={1.4}>{v.description}</Text> : null}
                      </Stack>
                    </Button>
                  </div>
                ))}
              </Stack>
            ))}
          </Stack>
        );
      }}
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
        <Text size="xs" c="gray.7" mt={4}>{visible.length} of {columns.length} shown. Company, account, environment and source are always shown.</Text>
      </div>
      {listed.length === 0 ? <Text size="sm" c="gray.7" role="status">No column is named like that.</Text> : null}
      <Stack gap={4} role="group" aria-label="Columns">
        {listed.map((c) => (
          <Checkbox
            key={c.name}
            size="xs"
            checked={set.has(c.name)}
            disabled={isOriginColumn(c.name) || (set.size === 1 && set.has(c.name)) || (!set.has(c.name) && set.size >= MAX_COLUMNS)}
            onChange={(e) => toggle(c.name, e.currentTarget.checked)}
            label={
              <Group gap={6} wrap="nowrap">
                <span title={c.description}>{c.label}</span>
                {isOriginColumn(c.name) ? <Badge size="xs" color="gray" variant="light" radius="sm" title="Where a row came from is always shown.">always shown</Badge> : null}
                {c.pii ? <Badge size="xs" color="red" variant="outline" radius="sm" title="Personal data. What you can see is decided by your permissions.">PII</Badge> : null}
              </Group>
            }
          />
        ))}
      </Stack>
    </Stack>
  );
};

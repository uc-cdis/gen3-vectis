import React, { useMemo } from 'react';
import type { MRT_ColumnDef, MRT_PaginationState, MRT_RowSelectionState } from 'mantine-react-table-open';
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table-open';
import { Badge, Group, Stack, Text } from '@mantine/core';
import type { AlertGroup } from '@/lib/vectis-kit/spec';
import { severityRank } from '@/lib/vectis-kit/spec';
import { formatNumber } from '@/lib/vectis-kit/ui/format';
import { EntityLink, SeverityBadge, StatusBadge, TierBadge } from '@/lib/vectis-kit/ui/primitives';
import Time from '@/lib/vectis-kit/ui/Time';
import { guessEntityType } from '@/lib/vectis-kit/spec/indicator';

const MAX_INDICATORS_SHOWN = 3;

/**
 * Allowed/blocked counts, with a worded verdict only where one is meaningful. "Control did not stop it" is an alarm, so it is
 * shown only for attack-class alerts (rule tier) where something was allowed. An indicator, baseline or novelty alert that
 * was allowed is not an attack that got through (an allowed `GET /` from a listed address is not an incident), so it
 * gets the neutral counts alone.
 */
export const ControlCell = ({ g }: { g: AlertGroup }) => {
  const attack = g.detector_tier === 'rule';
  const verdict = !attack ? null : g.control_worked ? 'worked' : g.allowed_count > 0 ? 'failed' : null;
  return (
    <Stack gap={2}>
      <Text size="xs">{formatNumber(g.allowed_count)} allowed / {formatNumber(g.blocked_count)} blocked</Text>
      {verdict ? (
        <Badge size="xs" radius="sm" variant="light" color={verdict === 'worked' ? 'green' : 'red'}>
          {verdict === 'worked' ? 'Control worked' : 'Control did not stop it'}
        </Badge>
      ) : null}
    </Stack>
  );
};

const columns: MRT_ColumnDef<AlertGroup>[] = [
  {
    id: 'severity', header: 'Severity', size: 92, enableSorting: true, sortDescFirst: true,
    // Sort key is the RANK, never the string ("low" would sort before "medium", "critical" before "high").
    accessorFn: (g) => severityRank(g.severity),
    Cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
  },
  {
    id: 'title', header: 'Alert', size: 280, enableSorting: false,
    accessorFn: (g) => g.title,
    Cell: ({ row }) => {
      const g = row.original;
      const shown = (g.matched_indicators ?? []).slice(0, MAX_INDICATORS_SHOWN);
      const more = (g.matched_indicators ?? []).length - shown.length;
      return (
        <Stack gap={2}>
          <Text size="sm" fw={600}>{g.title}</Text>
          {g.signature_label ? <Text size="xs" c="dimmed" ff="monospace">{g.signature_label}</Text> : null}
          {shown.length ? (
            <Group gap={6} onClick={(e) => e.stopPropagation()}>
              {shown.map((v) => <EntityLink key={v} type={guessEntityType(v)} value={v} />)}
              {more > 0 ? <Text size="xs" c="dimmed">+{more} more</Text> : null}
            </Group>
          ) : null}
        </Stack>
      );
    },
  },
  { id: 'tier', header: 'Tier', size: 84, enableSorting: false, accessorFn: (g) => g.detector_tier, Cell: ({ row }) => <TierBadge tier={row.original.detector_tier} /> },
  { id: 'rule', header: 'Rule', size: 150, enableSorting: false, accessorFn: (g) => g.rule_id ?? '', Cell: ({ row }) => (row.original.rule_id ? <Text size="xs" ff="monospace">{row.original.rule_id}</Text> : <Text size="xs" c="dimmed">—</Text>) },
  { id: 'first_seen', header: 'First seen', size: 100, enableSorting: false, accessorFn: (g) => g.first_seen, Cell: ({ row }) => <Time iso={row.original.first_seen} /> },
  { id: 'last_seen', header: 'Last seen', size: 92, enableSorting: false, accessorFn: (g) => g.last_seen, Cell: ({ row }) => <Time iso={row.original.last_seen} /> },
  { id: 'occurrences', header: 'Events', size: 72, enableSorting: false, accessorFn: (g) => g.occurrence_count, Cell: ({ row }) => <Text size="sm">{formatNumber(row.original.occurrence_count)}</Text> },
  { id: 'sources', header: 'Source IPs', size: 84, enableSorting: false, accessorFn: (g) => g.distinct_src_ips, Cell: ({ row }) => <Text size="sm">{formatNumber(row.original.distinct_src_ips)}</Text> },
  { id: 'control', header: 'Allowed / blocked', size: 172, enableSorting: false, accessorFn: (g) => g.allowed_count, Cell: ({ row }) => <ControlCell g={row.original} /> },
  { id: 'status', header: 'Status', size: 110, enableSorting: false, accessorFn: (g) => g.status ?? 'new', Cell: ({ row }) => <StatusBadge status={row.original.status ?? 'new'} /> },
  { id: 'assignee', header: 'Assignee', size: 100, enableSorting: false, accessorFn: (g) => g.assignee ?? '', Cell: ({ row }) => <Text size="sm" c={row.original.assignee ? undefined : 'dimmed'}>{row.original.assignee || '—'}</Text> },
  { id: 'case', header: 'Case', size: 90, enableSorting: false, accessorFn: (g) => g.case_id ?? '', Cell: ({ row }) => <Text size="xs" ff="monospace" c={row.original.case_id ? undefined : 'dimmed'}>{row.original.case_id || '—'}</Text> },
];

interface AlertsTableProps {
  groups: AlertGroup[];
  total: number;
  pagination: MRT_PaginationState;
  onPaginationChange: (p: MRT_PaginationState) => void;
  rowSelection: MRT_RowSelectionState;
  onRowSelectionChange: (s: MRT_RowSelectionState) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  busy: boolean;
}

const AlertsTable = ({ groups, total, pagination, onPaginationChange, rowSelection, onRowSelectionChange, activeId, onOpen, busy }: AlertsTableProps) => {
  const data = useMemo(() => groups, [groups]);
  const table = useMantineReactTable<AlertGroup>({
    columns,
    data,
    getRowId: (g) => g.group_id,
    enableRowSelection: true,
    enableColumnActions: false,
    enableColumnFilters: false,
    enableGlobalFilter: false,
    enableDensityToggle: false,
    enableFullScreenToggle: false,
    enableHiding: false,
    // The table is the triage view; the drawer carries the rest. Rule, First seen and Case are in the drawer, and Status stays
    // pinned at the right edge so it is visible however narrow the screen is.
    enableColumnPinning: true,
    initialState: { columnVisibility: { rule: false, first_seen: false, case: false }, columnPinning: { right: ['status'] } },
    enableTopToolbar: false,
    enableSortingRemoval: true,
    manualPagination: true,
    rowCount: total,
    state: { pagination, rowSelection, showProgressBars: busy },
    onPaginationChange: (u) => onPaginationChange(typeof u === 'function' ? u(pagination) : u),
    onRowSelectionChange: (u) => onRowSelectionChange(typeof u === 'function' ? u(rowSelection) : u),
    paginationDisplayMode: 'pages',
    mantinePaginationProps: { rowsPerPageOptions: ['50', '100', '250'] },
    mantineTableProps: { highlightOnHover: true, withTableBorder: true, 'aria-label': 'Alert groups' },
    mantineTableBodyRowProps: ({ row }) => ({
      onClick: () => onOpen(row.id),
      tabIndex: 0,
      'aria-current': row.id === activeId ? 'true' : undefined,
      'data-active': row.id === activeId ? 'true' : undefined,
      onKeyDown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(row.id); } },
      style: { cursor: 'pointer', outline: row.id === activeId ? '2px solid var(--mantine-color-blue-6)' : undefined, outlineOffset: -2 },
    }),
    mantineSelectCheckboxProps: ({ row }) => ({ 'aria-label': `Select alert ${row.original.title}` }),
    mantineSelectAllCheckboxProps: { 'aria-label': 'Select all alerts on this page' },
  });
  return <MantineReactTable table={table} />;
};
export default AlertsTable;

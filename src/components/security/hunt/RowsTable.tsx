import React, { useMemo } from 'react';
import { Text } from '@mantine/core';
import { EmptyTableMessage } from '@gen3/frontend';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table-open';
import type { ColumnMeta } from '@/lib/vectis-kit/spec';
import { EntityLink } from '@/lib/vectis-kit/ui/primitives';
import { formatTime } from '@/lib/vectis-kit/ui/format';
import { isIpAddress } from '@/lib/vectis-kit/spec/indicator';

type Row = Record<string, unknown>;

const Missing = () => <Text span size="sm" c="dimmed">—</Text>;

/** Cells are rendered as text. Addresses go through <EntityLink> so they open the entity drawer. */
function renderCell(meta: ColumnMeta | undefined, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') return <Missing />;
  if (meta?.type === 'ip' && typeof value === 'string' && isIpAddress(value)) return <EntityLink type="ip" value={value} />;
  if (meta?.type === 'timestamp' && typeof value === 'string') return formatTime(value);
  return String(value);
}

/** The raw rows behind a brushed range. Clicking a row selects it (single selection). */
export const RowsTable = ({ columns, meta, rows, selected, onSelect }: {
  columns: readonly string[];
  meta: readonly ColumnMeta[];
  rows: Row[];
  selected: number | null;
  onSelect: (index: number | null) => void;
}) => {
  const defs = useMemo<MRT_ColumnDef<Row>[]>(() => columns.map((name) => {
    const m = meta.find((c) => c.name === name);
    return { id: name, header: m?.label ?? name, accessorFn: (r: Row) => r[name], Cell: ({ cell }) => renderCell(m, cell.getValue()) };
  }), [columns, meta]);

  const table = useMantineReactTable<Row>({
    columns: defs,
    data: rows,
    enableSorting: false, // sorting 100 loaded rows would misrepresent the full range; the query sorts by time
    enableColumnActions: false,
    enableGlobalFilter: false,
    enableDensityToggle: false,
    enableFullScreenToggle: false,
    enableHiding: false,
    enableTopToolbar: false,
    initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
    paginationDisplayMode: 'pages',
    renderEmptyRowsFallback: () => <EmptyTableMessage message="No rows" />,
    mantineTableProps: { highlightOnHover: true, striped: true, 'aria-label': 'Rows in the selected time range' },
    mantineTableBodyRowProps: ({ row }) => ({
      onClick: () => onSelect(selected === row.index ? null : row.index),
      'aria-selected': selected === row.index,
      style: { cursor: 'pointer', backgroundColor: selected === row.index ? 'var(--mantine-color-blue-light)' : undefined },
    }),
  });
  return <MantineReactTable table={table} />;
};

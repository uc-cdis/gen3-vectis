import React from 'react';
import type { MRT_ColumnDef, MRT_Row, MRT_RowData } from 'mantine-react-table-open';
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table-open';

/** A small, dense, read-only table: no toolbars, no paging. Used for short lists (sources, queues, quarantine records). */
export function HealthTable<T extends MRT_RowData>({
  label, columns, data, rowProps,
}: {
  label: string;
  columns: MRT_ColumnDef<T>[];
  data: T[];
  rowProps?: (row: MRT_Row<T>) => Record<string, unknown>;
}) {
  const table = useMantineReactTable<T>({
    columns, data,
    enableColumnActions: false, enableColumnFilters: false, enableGlobalFilter: false, enableDensityToggle: false, enableFullScreenToggle: false,
    enableHiding: false, enableTopToolbar: false, enableBottomToolbar: false, enablePagination: false, enableSorting: false,
    initialState: { density: 'xs' },
    mantineTableProps: { 'aria-label': label, verticalSpacing: 4 },
    mantineTableBodyRowProps: ({ row }) => rowProps?.(row) ?? {},
    mantineTableBodyCellProps: { style: { paddingTop: 2, paddingBottom: 2 } },
    mantineTableHeadCellProps: { style: { paddingTop: 3, paddingBottom: 3 } },
  });
  return <MantineReactTable table={table} />;
}

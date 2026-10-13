import React from 'react';
import { Code, Group, Stack, Text } from '@mantine/core';
import type { MRT_ColumnDef, MRT_RowData } from 'mantine-react-table-open';
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table-open';
import { safeText } from '@/lib/safe-text';
import { CopyIcon } from '@/lib/vectis-kit/ui/primitives';

// Small presentational blocks the console and the dictionary share: a copyable value, a label/value list, a plain table.

/** A value shown as monospace text with a copy button. `what` names it for screen readers ("entity key"). */
export const CopyValue = ({ value, what, max = 200 }: { value: string; what: string; max?: number }) => (
  <Group gap={4} wrap="nowrap">
    <Code style={{ overflowWrap: 'anywhere' }}>{safeText(value, max)}</Code>
    <CopyIcon value={value} what={what} />
  </Group>
);

interface Fact { label: string; value: React.ReactNode }

/** Label and value pairs as a description list. Values are React nodes, so callers pass text or <Unmeasured />. */
export const FactList = ({ facts, label }: { facts: Fact[]; label?: string }) => (
  <Stack gap={4} component="dl" m={0} aria-label={label}>
    {facts.map((f) => (
      <Group key={f.label} gap="xs" wrap="nowrap" align="baseline">
        <Text component="dt" size="sm" c="dimmed" w={110} style={{ flexShrink: 0 }}>{f.label}</Text>
        <Text component="dd" size="sm" m={0} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{f.value}</Text>
      </Group>
    ))}
  </Stack>
);

interface SimpleTableProps<T extends MRT_RowData> {
  columns: MRT_ColumnDef<T>[];
  data: T[];
  /** Accessible name of the table. */
  caption: string;
  pageSize?: number;
}

/** A small, read-only table (no toolbars, paging only when needed). One wrapper so every list looks the same. */
export function SimpleTable<T extends MRT_RowData>({ columns, data, caption, pageSize = 10 }: SimpleTableProps<T>) {
  const paged = data.length > pageSize;
  const table = useMantineReactTable<T>({
    columns,
    data,
    enableTopToolbar: false,
    enableColumnActions: false,
    enableBottomToolbar: paged,
    enablePagination: paged,
    enableDensityToggle: false,
    enableFullScreenToggle: false,
    initialState: { pagination: { pageIndex: 0, pageSize }, density: 'xs' },
    mantineTableProps: { striped: true, highlightOnHover: true, 'aria-label': caption },
  });
  return <MantineReactTable table={table} />;
}

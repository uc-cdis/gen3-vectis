import React from 'react';
import { ActionIcon, Button, Group, Select, Text, Tooltip } from '@mantine/core';
import { IconSortAscending, IconSortDescending } from '@tabler/icons-react';
import type { ColumnMeta, SortSpec } from '@/lib/vectis-kit/spec';
import { formatNumber, formatTime } from '@/lib/vectis-kit/ui/format';

const PAGE_SIZES = [50, 100, 250] as const;

/** The honest count. A null total means "at least what has been seen", never zero and never exact. */
function countText(offset: number, shown: number, total: number | null | undefined): string {
  if (shown === 0) return total === null || total === undefined ? 'No rows on this page.' : `0 of ${formatNumber(total)} rows`;
  const from = offset + 1;
  const to = offset + shown;
  return total === null || total === undefined
    ? `Rows ${formatNumber(from)} to ${formatNumber(to)} of at least ${formatNumber(to)}`
    : `Rows ${formatNumber(from)} to ${formatNumber(to)} of ${formatNumber(total)}`;
}

export const ResultBar = ({
  offset, shown, total, hasMore, pageSize, sortable, sort, asOf, version, updating, onPage, onPageSize, onSort,
}: {
  offset: number;
  shown: number;
  total: number | null | undefined;
  hasMore: boolean;
  pageSize: number;
  sortable: readonly ColumnMeta[];
  sort: SortSpec | null;
  asOf: string;
  version: number | null | undefined;
  updating: boolean;
  onPage: (offset: number) => void;
  onPageSize: (n: number) => void;
  onSort: (s: SortSpec | null) => void;
}) => (
  <Group justify="space-between" align="center" gap="sm" wrap="wrap">
    <div>
      <Text size="sm" fw={600} data-testid="result-count" role="status" aria-live="polite">{countText(offset, shown, total)}</Text>
      <Text size="xs" c="gray.7">
        As of {formatTime(asOf)}, data version {version === null || version === undefined ? 'unknown' : version}.{updating ? ' Updating…' : ''}
      </Text>
    </div>
    <Group gap="xs" align="flex-end">
      <Select
        size="xs" w={170} label="Sort by" placeholder="Default order" clearable
        value={sort?.field ?? null}
        data={sortable.map((c) => ({ value: c.name, label: c.label }))}
        onChange={(v) => onSort(v ? { field: v, dir: sort?.dir ?? 'desc' } : null)}
      />
      <Tooltip label={sort?.dir === 'asc' ? 'Ascending. Click for descending.' : 'Descending. Click for ascending.'} withArrow>
        <ActionIcon
          variant="default" size={30} disabled={!sort}
          aria-label={`Sort direction: ${sort?.dir === 'asc' ? 'ascending' : 'descending'}`}
          onClick={() => sort && onSort({ field: sort.field, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
        >
          {sort?.dir === 'asc' ? <IconSortAscending size={16} /> : <IconSortDescending size={16} />}
        </ActionIcon>
      </Tooltip>
      <Select
        size="xs" w={90} label="Page size" allowDeselect={false}
        value={String(pageSize)} data={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
        onChange={(v) => v && onPageSize(Number(v))}
      />
      <Button size="xs" variant="default" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - pageSize))}>Previous</Button>
      <Button size="xs" variant="default" disabled={!hasMore} onClick={() => onPage(offset + pageSize)}>Next</Button>
    </Group>
  </Group>
);

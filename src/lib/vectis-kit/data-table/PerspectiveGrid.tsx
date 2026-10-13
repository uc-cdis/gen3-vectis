import dynamic from 'next/dynamic';
import { Skeleton } from '@mantine/core';
import type { ColumnMeta, SortSpec } from '../spec';

export interface PerspectiveGridProps {
  /** Column names, in display order. */
  columns: string[];
  /** Exactly the rows the API returned; the grid never loads more or fewer. */
  rows: Record<string, unknown>[];
  meta: ColumnMeta[];
  /** A saved view's Perspective config (plugin, group_by, split_by, sort). Unknown parts are ignored. */
  layout?: Record<string, unknown> | null;
  /** Server-side sort. Changing it in the viewer's own header calls onSortChange; it never only sorts locally. */
  sort?: SortSpec | null;
  onSortChange?: (sort: SortSpec | null) => void;
  /** Called with the original row object when the user clicks a cell. */
  onRowClick?: (row: Record<string, unknown>) => void;
  height?: number;
  label?: string;
}

/**
 * Perspective data grid with the Gen3 look. Client-side only: the implementation is loaded with ssr:false, so
 * WebAssembly is fetched only when a grid is actually shown.
 */
export const PerspectiveGrid = dynamic<PerspectiveGridProps>(() => import('./PerspectiveGridInner'), {
  ssr: false,
  loading: () => <Skeleton role="status" height={600} radius="sm" aria-busy="true" aria-label="Loading the grid" data-testid="grid-loading" />,
});

export default PerspectiveGrid;

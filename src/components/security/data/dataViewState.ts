/**
 * The Data tab's current view (index, columns, filters, sort, saved view) as URL query parameters, so a page refresh,
 * a copied link or the back button returns to the same table. Kept apart from the deep link (`hunt_*`), which is a one-shot
 * instruction from an alert or Hunt: these are the analyst's own working state and are always written back.
 */
import type { FilterClause, SortSpec } from '@/lib/vectis-kit/spec';
import { COLUMN_NAME, parseFilters } from '../hunt/huntModel';

const KEYS = { index: 'd_index', columns: 'd_cols', filters: 'd_filters', sort: 'd_sort', view: 'd_view' } as const;
const MAX_COLUMNS = 60;
const MAX_FILTERS_CHARS = 32_768;
const VIEW_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export interface DataViewState {
  index: string | null;
  /** null = the index's default columns */
  columns: string[] | null;
  filters: FilterClause[];
  sort: SortSpec | null;
  viewId: string | null;
}

export const EMPTY_DATA_VIEW: DataViewState = { index: null, columns: null, filters: [], sort: null, viewId: null };

/** What the URL says, with every part checked; a part that does not read is left out, never half applied. */
export function readDataView(q: Query): DataViewState {
  const index = first(q[KEYS.index]);
  const cols = first(q[KEYS.columns]);
  const columns = cols ? cols.split(',') : [];
  const sort = first(q[KEYS.sort])?.split(':');
  const view = first(q[KEYS.view]);
  let filters: FilterClause[] = [];
  const rawFilters = first(q[KEYS.filters]);
  if (rawFilters && rawFilters.length <= MAX_FILTERS_CHARS) {
    try { filters = parseFilters(JSON.parse(rawFilters)) ?? []; } catch { filters = []; }
  }
  return {
    index: index && COLUMN_NAME.test(index) ? index : null,
    columns: columns.length > 0 && columns.length <= MAX_COLUMNS && columns.every((c) => COLUMN_NAME.test(c)) ? columns : null,
    filters,
    sort: sort && sort.length === 2 && COLUMN_NAME.test(sort[0] as string) && (sort[1] === 'asc' || sort[1] === 'desc')
      ? { field: sort[0] as string, dir: sort[1] }
      : null,
    viewId: view && VIEW_ID.test(view) ? view : null,
  };
}

/** The query with this view's parameters set (or removed when empty). Every other parameter is kept. */
export function writeDataView(q: Query, s: DataViewState): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) { const f = first(v); if (f !== undefined && f !== '') next[k] = f; }
  const set = (key: string, value: string | null) => { if (value === null) delete next[key]; else next[key] = value; };
  set(KEYS.index, s.index);
  set(KEYS.columns, s.columns && s.columns.length > 0 ? s.columns.join(',') : null);
  set(KEYS.filters, s.filters.length > 0 ? JSON.stringify(s.filters) : null);
  set(KEYS.sort, s.sort ? `${s.sort.field}:${s.sort.dir}` : null);
  set(KEYS.view, s.viewId);
  return next;
}

/** True when two queries carry the same view parameters, so writing one over the other would change nothing. */
export const sameDataView = (a: Query, b: Query): boolean => Object.values(KEYS).every((k) => (first(a[k]) ?? '') === (first(b[k]) ?? ''));

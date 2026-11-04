/**
 * Pure model for the Hunt tab: the analyst's current view of the data, how it maps to and from a QuerySpec,
 * how it is carried in the URL, and the contract limits every user-typed value is checked against.
 */
import type { CatalogResponse, FilterClause, HuntQuery, IndexCatalog, IndexName, QuerySpec, SortSpec, TimeWindow } from '@/lib/vectis-kit/spec';
import type { Grain, TimeRange } from '@/lib/vectis-kit/timeseries/rollupOption';
import { hasControlChars, hasParserUnsafeChars, safeText } from '@/lib/safe-text';

const HUNT_INDEXES: readonly IndexName[] = ['http_activity', 'api_activity', 'network_activity', 'all_events'];

/** Reads every index at once; the hunt starts here, split by index_name. */
export const ALL_EVENTS: IndexName = 'all_events';
export const defaultGroupBy = (index: IndexName): string[] => (index === ALL_EVENTS ? ['index_name'] : []);
export const GRAINS: readonly Grain[] = ['1m', '5m', '1h'];
export const MAX_GROUP_BY = 3;
export const MAX_ROWS = 100;
const MAX_COLUMNS = 60;
const MAX_FILTERS = 20;
const MAX_IN_VALUES = 100;
const MAX_FILTER_TEXT = 512;
const MAX_FILTERS_PARAM_CHARS = 32_768;
const MAX_WINDOW_MS = 92 * 86_400_000;

// Same grammar as the backend (contract.py). JS `$` without the `m` flag matches only at the very end, so a
// trailing newline is rejected here as it is there.
export const COLUMN_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const isGrain = (v: unknown): v is Grain => typeof v === 'string' && (GRAINS as readonly string[]).includes(v);
const isHuntIndex = (v: unknown): v is IndexName => typeof v === 'string' && (HUNT_INDEXES as readonly string[]).includes(v);

// ------------------------------------------------------------------ validation (returns an error message or null)

export function validateTitle(raw: string): string | null {
  const t = raw.trim();
  if (t.length === 0) return 'Give the hunt a title.';
  if (t.length > 256) return 'The title can be at most 256 characters.';
  if (hasControlChars(t)) return 'The title cannot contain control characters.';
  return null;
}
export function validateHypothesis(raw: string): string | null {
  return raw.trim().length > 8192 ? 'The hypothesis can be at most 8192 characters.' : null;
}
export function validateAlertId(raw: string): string | null {
  if (raw.length === 0) return 'Enter an alert id.';
  return IDENTIFIER.test(raw) ? null : 'An alert id starts with a letter or digit and uses only letters, digits and . _ : -';
}
export function validateEntityValue(raw: string): string | null {
  const v = raw.trim();
  if (v.length === 0) return 'Enter a value.';
  if (v.length > 512) return 'The value can be at most 512 characters.';
  if (hasControlChars(v)) return 'The value cannot contain control characters.';
  return null;
}

// ------------------------------------------------------------------ windows

/** A usable window: both ends readable ISO, start before end, at most 92 days. Anything else is null. */
export function parseRange(from: unknown, to: unknown): TimeRange | null {
  if (typeof from !== 'string' || typeof to !== 'string' || !ISO.test(from) || !ISO.test(to)) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b || b - a > MAX_WINDOW_MS) return null;
  return { start: new Date(a).toISOString(), end: new Date(b).toISOString() };
}

// ------------------------------------------------------------------ URL (deep link)

const LINK_KEYS = { index: 'hunt_index', from: 'hunt_from', to: 'hunt_to', grain: 'hunt_grain', filters: 'hunt_filters' } as const;
type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const FILTER_OPS: readonly string[] = ['eq', 'neq', 'in', 'gte', 'lte', 'contains'];
const isScalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const isFilterText = (v: unknown): boolean => typeof v !== 'string' || (v.length <= MAX_FILTER_TEXT && !hasParserUnsafeChars(v));

function isFilterClause(c: unknown): c is FilterClause {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return false;
  const { field, op, value, ...extra } = c as Record<string, unknown>;
  if (Object.keys(extra).length > 0 || typeof field !== 'string' || !COLUMN_NAME.test(field)) return false;
  if (typeof op !== 'string' || !FILTER_OPS.includes(op)) return false;
  if (op === 'in') {
    return Array.isArray(value) && value.length > 0 && value.length <= MAX_IN_VALUES && value.every((v) => typeof v !== 'boolean' && isScalar(v) && isFilterText(v));
  }
  return isScalar(value) && isFilterText(value);
}

/** The filters if every clause is well formed, else null. One bad clause drops the set: a quietly widened query would mislead. */
export function parseFilters(raw: unknown): FilterClause[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FILTERS) return null;
  return raw.every(isFilterClause) ? (raw as FilterClause[]).map((c) => ({ field: c.field, op: c.op, value: c.value })) : null;
}

function readFilters(raw: string | undefined): FilterClause[] {
  if (!raw || raw.length > MAX_FILTERS_PARAM_CHARS) return [];
  try { return parseFilters(JSON.parse(raw)) ?? []; } catch { return []; }
}

/** Filters that name a column the index does not have cannot be run; the whole set is then ignored, never partly applied. */
export const filtersForIndex = (filters: readonly FilterClause[], index: { columns: readonly { name: string }[] }): FilterClause[] =>
  (filters.every((f) => index.columns.some((c) => c.name === f.field)) ? [...filters] : []);

/** The index a link names, for a page that can open any index (the Data tab). Hunt reads `readDeepLink`, which keeps to the indexes it can run. */
export function readLinkIndex(q: Query): IndexName | null {
  const v = first(q[LINK_KEYS.index]);
  return typeof v === 'string' && COLUMN_NAME.test(v) ? v : null;
}

export interface DeepLink { index: IndexName | null; grain: Grain | null; range: TimeRange | null; filters: FilterClause[] }
export function readDeepLink(q: Query): DeepLink {
  const index = first(q[LINK_KEYS.index]);
  const grain = first(q[LINK_KEYS.grain]);
  return {
    index: isHuntIndex(index) ? index : null,
    grain: isGrain(grain) ? grain : null,
    range: parseRange(first(q[LINK_KEYS.from]), first(q[LINK_KEYS.to])),
    filters: readFilters(first(q[LINK_KEYS.filters])),
  };
}
/** Returns a new query with the given link fields replaced; `null` removes a field. Other query keys are kept. */
export function writeDeepLink(q: Query, patch: { index?: IndexName | null; grain?: Grain | null; range?: TimeRange | null; filters?: readonly FilterClause[] | null }): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) { const s = first(v); if (s !== undefined && s !== '') next[k] = s; }
  const set = (key: string, value: string | null | undefined) => { if (value === null) delete next[key]; else if (value !== undefined) next[key] = value; };
  set(LINK_KEYS.index, patch.index);
  set(LINK_KEYS.grain, patch.grain);
  if (patch.range !== undefined) { set(LINK_KEYS.from, patch.range?.start ?? null); set(LINK_KEYS.to, patch.range?.end ?? null); }
  if (patch.filters !== undefined) set(LINK_KEYS.filters, patch.filters && patch.filters.length > 0 ? JSON.stringify(patch.filters) : null);
  return next;
}

/** The Hunt link for an alert's stored query, or null when any part of it is not one the Hunt page can run. */
export function huntLinkFor(hunt: HuntQuery): Record<string, string> | null {
  const range = parseRange(hunt.window.start, hunt.window.end);
  const filters = parseFilters(hunt.filters);
  if (!isHuntIndex(hunt.index_name) || !range || !filters) return null;
  return writeDeepLink({}, { index: hunt.index_name, range, filters });
}

/** The link that opens the Data tab (or Hunt) on a query; null parts are left out. */
export const linkForQuery = (q: { index: IndexName; range: TimeRange | null; filters: readonly FilterClause[] }): Record<string, string> =>
  writeDeepLink({}, { index: q.index, range: q.range, filters: q.filters });

/** One line saying what a filter does, for display. */
export const describeFilter = (f: FilterClause): string => `${f.field} ${f.op} ${Array.isArray(f.value) ? `${f.value.length} values` : safeText(f.value, 60)}`;

// ------------------------------------------------------------------ catalog helpers

export const huntIndexes = (c: CatalogResponse): IndexCatalog[] => c.indexes.filter((i) => isHuntIndex(i.index_name));
export const defaultColumns = (i: IndexCatalog): string[] => i.columns.filter((c) => c.default_visible).map((c) => c.name).slice(0, MAX_COLUMNS);
export const groupableColumns = (i: IndexCatalog): { value: string; label: string }[] =>
  i.columns.filter((c) => c.type === 'enum' && COLUMN_NAME.test(c.name)).map((c) => ({ value: c.name, label: c.label }));

// ------------------------------------------------------------------ view state <-> QuerySpec

export interface ViewState {
  columns: string[] | null;
  filters: FilterClause[];
  sort: SortSpec | null;
  groupBy: string[];
  /** The window the chart covers. null = the console's selected range. */
  chartWindow: TimeWindow | null;
}
export const EMPTY_VIEW: ViewState = { columns: null, filters: [], sort: null, groupBy: [], chartWindow: null };

export function specFromView(args: { index: IndexCatalog; grain: Grain; view: ViewState; range: TimeRange | null; consoleWindow: TimeWindow }): QuerySpec {
  const { index, grain, view, range, consoleWindow } = args;
  return {
    index_name: index.index_name,
    window: range ?? view.chartWindow ?? consoleWindow,
    filters: view.filters.slice(0, MAX_FILTERS),
    columns: (view.columns ?? defaultColumns(index)).filter((c) => COLUMN_NAME.test(c)).slice(0, MAX_COLUMNS),
    sort: view.sort ?? { field: index.time_field, dir: 'desc' },
    grain,
    seed: null,
  };
}

interface AppliedSpec { index: IndexName; grain: Grain | null; range: TimeRange | null; view: ViewState }
/** Reads a saved view or hunt back into state. Unknown indexes yield null; unknown columns are dropped, never invented. */
export function applySpec(spec: QuerySpec, catalog: CatalogResponse): AppliedSpec | null {
  const index = huntIndexes(catalog).find((i) => i.index_name === spec.index_name);
  if (!index) return null;
  const known = new Set(index.columns.map((c) => c.name));
  const columns = (spec.columns ?? []).filter((c) => known.has(c) && COLUMN_NAME.test(c)).slice(0, MAX_COLUMNS);
  const range = parseRange(spec.window.start, spec.window.end);
  return {
    index: index.index_name,
    grain: isGrain(spec.grain) ? spec.grain : null,
    range,
    view: {
      columns: columns.length > 0 ? columns : null,
      filters: (spec.filters ?? []).slice(0, MAX_FILTERS),
      sort: spec.sort && known.has(spec.sort.field) ? spec.sort : null,
      groupBy: defaultGroupBy(index.index_name),
      chartWindow: range ? { start: range.start, end: range.end } : null,
    },
  };
}

/**
 * What the grid hands to Perspective, both pure so they are unit-tested without a browser:
 *  - toColumnar: an API rows response as columnar data plus a typed schema. It never adds, drops or invents a row.
 *  - sanitizeLayout: a saved view's Perspective config, reduced to the parts the grid understands.
 */
import type { ColumnMeta } from '../spec';

// ---------------------------------------------------------------- rows -> columnar
type PspType = 'string' | 'integer' | 'float' | 'boolean' | 'datetime';
type Cell = string | number | boolean | null;
interface ColumnarData { schema: Record<string, PspType>; data: Record<string, Cell[]>; rowCount: number }

const INT32_MAX = 2_147_483_647;

function pspTypeFor(meta: ColumnMeta | undefined): PspType {
  switch (meta?.type) {
    case 'integer': return 'integer';
    case 'float': return 'float';
    case 'boolean': return 'boolean';
    case 'timestamp': return 'datetime';
    default: return 'string';
  }
}

function toCell(v: unknown, type: PspType): Cell {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'integer': case 'float': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;
    case 'datetime': {
      const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
      return Number.isFinite(ms) ? ms : null;
    }
    default:
      // Objects and arrays are shown as their JSON text, never as "[object Object]".
      return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  }
}

export function toColumnar(columns: readonly string[], rows: readonly Record<string, unknown>[], meta: readonly ColumnMeta[]): ColumnarData {
  const byName = new Map(meta.map((m) => [m.name, m]));
  const schema: Record<string, PspType> = {};
  const data: Record<string, Cell[]> = {};
  for (const name of columns) {
    let type = pspTypeFor(byName.get(name));
    let cells = rows.map((r) => toCell(r[name], type));
    // Perspective integers are 32-bit; a wider value would overflow, so such a column is stored as a double instead.
    if (type === 'integer' && cells.some((c) => typeof c === 'number' && (Math.abs(c) > INT32_MAX || !Number.isInteger(c)))) {
      type = 'float';
      cells = rows.map((r) => toCell(r[name], 'float'));
    }
    schema[name] = type;
    data[name] = cells;
  }
  return { schema, data, rowCount: rows.length };
}

// ---------------------------------------------------------------- saved layout
/**
 * A saved view's `layout` is the Perspective config the analyst last used. It comes from the API, so only the parts the
 * grid understands are passed on, and only when they name columns that exist. Anything else is dropped, never guessed.
 */
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9 /_-]{0,39}$/;

/** The only expression a layout may carry: bucketing a known timestamp column, which is what a time chart needs. */
const BUCKET_EXPR = /^bucket\("([A-Za-z0-9_]{1,64})", '(s|m|h|D|W|M|Y)'\)$/;
const BUCKET_NAME = /^[A-Za-z][A-Za-z0-9_ ]{0,39}$/;

export function sanitizeLayout(layout: Record<string, unknown> | null | undefined, columns: readonly string[]): Record<string, unknown> {
  if (!layout || typeof layout !== 'object') return {};
  const out0: Record<string, unknown> = {};
  const known = new Set(columns);
  const exprs: Record<string, string> = {};
  if (layout.expressions && typeof layout.expressions === 'object' && !Array.isArray(layout.expressions)) {
    for (const [name, text] of Object.entries(layout.expressions as Record<string, unknown>)) {
      const m = typeof text === 'string' ? BUCKET_EXPR.exec(text) : null;
      if (BUCKET_NAME.test(name) && m && known.has(m[1]) && !known.has(name)) { exprs[name] = text as string; known.add(name); }
    }
  }
  if (Object.keys(exprs).length) out0.expressions = exprs;
  const cols = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((c) => typeof c === 'string' && known.has(c)) ? (v as string[]) : null;
  const out: Record<string, unknown> = { ...out0 };
  if (typeof layout.plugin === 'string' && PLUGIN_NAME.test(layout.plugin)) out.plugin = layout.plugin;
  const group = cols(layout.group_by);
  if (group && group.length) out.group_by = group;
  const split = cols(layout.split_by);
  const aggs = layout.aggregates;
  if (aggs && typeof aggs === 'object' && !Array.isArray(aggs)) {
    const ok = Object.entries(aggs as Record<string, unknown>).filter(([k, v]) => known.has(k) && typeof v === 'string' && /^(count|sum|avg|min|max|distinct count|unique)$/.test(v));
    if (ok.length) out.aggregates = Object.fromEntries(ok);
  }
  const shown = cols(layout.columns);
  if (shown && shown.length) out.columns = shown;
  if (split && split.length) out.split_by = split;
  if (Array.isArray(layout.sort)) {
    const sort = layout.sort.filter(
      (s): s is [string, string] => Array.isArray(s) && typeof s[0] === 'string' && known.has(s[0]) && (s[1] === 'asc' || s[1] === 'desc'),
    );
    if (sort.length) out.sort = sort;
  }
  return out;
}

let tableSeq = 0;
/** A table name unique across the page's one Perspective client; a per-grid counter reused names while an old table was still being deleted. */
export const nextTableName = (): string => `rows-${(tableSeq += 1)}`;

/**
 * Whether the viewer's settings sidebar is open after a config update. The viewer reports it as `settings`; the grid has to
 * follow it, or the next config it sends back (every filter or sort edit makes one) shuts the panel the person is using.
 */
export const settingsOpen = (update: { settings?: unknown }, previous: boolean): boolean =>
  typeof update.settings === 'boolean' ? update.settings : previous;

/**
 * Filter model for the Data view. The state IS the contract's FilterClause[]: nothing is translated twice, so a saved
 * view's filters load losslessly and every active clause is one removable chip.
 *
 * Limits mirror the service (siem-app contract.py): 20 clauses, 100 values in an `in`, 512 characters in a string.
 * Over-limit input is REJECTED with a reason; it is never silently truncated, because a truncated filter would
 * quietly widen a query.
 */
import type { ColumnMeta, FilterClause } from '../spec';

export const MAX_FILTERS = 20;
export const MAX_IN_VALUES = 100;
const MAX_FILTER_TEXT = 512;
export const COLUMN_NAME = /^[a-z][a-z0-9_]{0,63}$/;

type ValidationResult = { ok: true; clauses: FilterClause[] } | { ok: false; error: string };

type Scalar = string | number | boolean;
const isScalar = (v: unknown): v is Scalar =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** Checks a clause list against the service's limits. Returns the same clauses when valid. */
export function validateClauses(clauses: readonly FilterClause[]): ValidationResult {
  if (clauses.length > MAX_FILTERS) {
    return { ok: false, error: `Too many filters: ${clauses.length} active, the limit is ${MAX_FILTERS}. Remove some to run the query.` };
  }
  for (const c of clauses) {
    if (!COLUMN_NAME.test(c.field)) return { ok: false, error: 'A filter names a column that is not valid.' };
    if (c.op === 'in') {
      if (!Array.isArray(c.value) || c.value.length === 0) return { ok: false, error: `The "${c.field}" filter has no values.` };
      if (c.value.length > MAX_IN_VALUES) {
        return { ok: false, error: `Too many values for "${c.field}": ${c.value.length} selected, the limit is ${MAX_IN_VALUES}.` };
      }
      if (!c.value.every((v) => (typeof v === 'string' && v.length <= MAX_FILTER_TEXT) || (typeof v === 'number' && Number.isFinite(v)))) {
        return { ok: false, error: `A value for "${c.field}" is not valid.` };
      }
    } else {
      if (Array.isArray(c.value) || !isScalar(c.value)) return { ok: false, error: `The "${c.field}" filter needs a single value.` };
      if (typeof c.value === 'string' && c.value.length > MAX_FILTER_TEXT) {
        return { ok: false, error: `The "${c.field}" value is too long (limit ${MAX_FILTER_TEXT} characters).` };
      }
    }
  }
  return { ok: true, clauses: [...clauses] };
}

/** Everything the user has set on one column through the rail, read back out of the clause list. */
export function clausesFor(clauses: readonly FilterClause[], field: string): FilterClause[] {
  return clauses.filter((c) => c.field === field);
}

const without = (clauses: readonly FilterClause[], field: string, ops: readonly FilterClause['op'][]) =>
  clauses.filter((c) => !(c.field === field && ops.includes(c.op)));

/** Replace the selection for an enum column. An empty selection removes the filter. One value is an `eq`. */
export function setEnumSelection(clauses: readonly FilterClause[], field: string, values: readonly string[]): FilterClause[] {
  const rest = without(clauses, field, ['in', 'eq']);
  if (values.length === 0) return rest;
  const unique = [...new Set(values)];
  return [...rest, unique.length === 1 ? { field, op: 'eq', value: unique[0] as string } : { field, op: 'in', value: unique }];
}

/** The values currently chosen for an enum column (from an `eq` or an `in`). */
export function enumSelection(clauses: readonly FilterClause[], field: string): string[] {
  for (const c of clauses) {
    if (c.field !== field) continue;
    if (c.op === 'in' && Array.isArray(c.value)) return c.value.map(String);
    if (c.op === 'eq') return [String(c.value)];
  }
  return [];
}

/** Set a numeric range. Blank bounds are removed; NaN is rejected by returning the clauses unchanged plus an error. */
export function setRange(
  clauses: readonly FilterClause[], field: string, min: number | null, max: number | null,
): { clauses: FilterClause[]; error: string | null } {
  if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
    return { clauses: [...clauses], error: 'Enter numbers only.' };
  }
  if (min !== null && max !== null && min > max) return { clauses: [...clauses], error: 'The minimum is larger than the maximum.' };
  const next = without(clauses, field, ['gte', 'lte']);
  if (min !== null) next.push({ field, op: 'gte', value: min });
  if (max !== null) next.push({ field, op: 'lte', value: max });
  return { clauses: next, error: null };
}

/** Set a text filter (`contains` or `eq`). Blank removes it. */
export function setText(clauses: readonly FilterClause[], field: string, op: 'contains' | 'eq', text: string): FilterClause[] {
  const rest = without(clauses, field, ['contains', 'eq']);
  const t = text.trim();
  return t === '' ? rest : [...rest, { field, op, value: t }];
}

export const removeClauseAt = (clauses: readonly FilterClause[], index: number): FilterClause[] => clauses.filter((_, i) => i !== index);

const OP_WORD: Record<FilterClause['op'], string> = { eq: 'is', neq: 'is not', in: 'is one of', gte: 'at least', lte: 'at most', contains: 'contains' };

interface Chip { key: string; label: string; field: string }

/** One chip per clause. The label is plain text (the caller renders it as text, never HTML). */
export function clauseChips(clauses: readonly FilterClause[], columns: readonly ColumnMeta[]): Chip[] {
  const labels = new Map(columns.map((c) => [c.name, c.label]));
  return clauses.map((c, i) => {
    const name = labels.get(c.field) ?? c.field;
    const value = Array.isArray(c.value)
      ? c.value.length > 3 ? `${c.value.slice(0, 3).join(', ')} and ${c.value.length - 3} more` : c.value.join(', ')
      : String(c.value);
    return { key: `${i}:${c.field}:${c.op}`, field: c.field, label: `${name} ${OP_WORD[c.op]} ${value}` };
  });
}

/** The rail control kind for a column, or null when the column is not filterable here. */
type FilterKind = 'enum' | 'range' | 'text' | 'time' | 'boolean' | null;
export function filterKind(col: ColumnMeta): FilterKind {
  if (col.filterable === false) return null;
  switch (col.type) {
    case 'enum': return 'enum';
    case 'boolean': return 'boolean';
    case 'integer': case 'float': return 'range';
    case 'timestamp': return 'time'; // handled by the console's global time range
    case 'string': case 'ip': return 'text';
    default: return null;
  }
}

/** Drop clauses that name columns the (new) index does not have, e.g. when the index changes. */
export const keepKnownFields = (clauses: readonly FilterClause[], columns: readonly ColumnMeta[]): FilterClause[] => {
  const known = new Set(columns.map((c) => c.name));
  return clauses.filter((c) => known.has(c.field));
};

/** Boolean column: `null` removes the filter. */
export function setBoolean(clauses: readonly FilterClause[], field: string, value: boolean | null): FilterClause[] {
  const rest = without(clauses, field, ['eq']);
  return value === null ? rest : [...rest, { field, op: 'eq', value }];
}

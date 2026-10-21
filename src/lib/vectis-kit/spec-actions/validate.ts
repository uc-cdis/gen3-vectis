import type { FilterClause, QuerySpec } from '../spec';
import { COLUMN_NAME, validateClauses } from '../data-table/filters';

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecError';
  }
}

const MAX_SPEC_COLUMNS = 60;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validates a spec against the contract's limits and returns a CLEAN copy holding only known keys. Everything the code
 * generators emit comes from this copy, so unexpected properties on a hostile object can never reach generated code.
 */
export function cleanSpec(spec: QuerySpec): QuerySpec {
  if (!spec || typeof spec !== 'object') throw new SpecError('There is no query to render.');
  if (typeof spec.index_name !== 'string' || !COLUMN_NAME.test(spec.index_name)) throw new SpecError('The index name is not valid.');
  const w = spec.window;
  if (!w || typeof w.start !== 'string' || typeof w.end !== 'string' || !ISO.test(w.start) || !ISO.test(w.end)) {
    throw new SpecError('The time window is not valid.');
  }
  const columns = spec.columns ?? [];
  if (!Array.isArray(columns) || columns.length > MAX_SPEC_COLUMNS || !columns.every((c) => typeof c === 'string' && COLUMN_NAME.test(c))) {
    throw new SpecError(`Columns must be at most ${MAX_SPEC_COLUMNS} valid column names.`);
  }
  const checked = validateClauses(spec.filters ?? []);
  if (!checked.ok) throw new SpecError(checked.error);
  let sort: QuerySpec['sort'] = null;
  if (spec.sort) {
    if (typeof spec.sort.field !== 'string' || !COLUMN_NAME.test(spec.sort.field) || (spec.sort.dir !== undefined && spec.sort.dir !== 'asc' && spec.sort.dir !== 'desc')) {
      throw new SpecError('The sort is not valid.');
    }
    sort = { field: spec.sort.field, dir: spec.sort.dir ?? 'desc' };
  }
  const filters: FilterClause[] = checked.clauses.map((c) => ({ field: c.field, op: c.op, value: Array.isArray(c.value) ? [...c.value] : c.value }));
  return { index_name: spec.index_name, window: { start: w.start, end: w.end }, columns: [...columns], filters, sort };
}

/** The `rows` request body for a spec (the same shape the console sends). */
export function rowsBody(spec: QuerySpec, paging?: { limit: number; offset: number }) {
  const s = cleanSpec(spec);
  return {
    index_name: s.index_name,
    window: s.window,
    filters: s.filters ?? [],
    columns: s.columns ?? [],
    ...(s.sort ? { sort: s.sort } : {}),
    ...(paging ? { paging } : {}),
  };
}

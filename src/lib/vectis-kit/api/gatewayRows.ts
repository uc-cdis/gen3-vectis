import { GEN3_GUPPY_API } from '@gen3/core';
import { sanitizeUntrusted } from '@/lib/safe-text';
import type { FilterClause, RowsResponse, SortSpec, TimeWindow } from '../spec';
import { guppyClause } from '../spec-actions/snippets';
import { GatewayError, gatewayPost } from './gatewayGraph';

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TIME_FIELD = 'event_time';
const MAX_FIRST = 250;

export interface RowsBody {
  index_name: string;
  window: TimeWindow;
  filters?: FilterClause[];
  columns?: string[];
  sort?: SortSpec | null;
  paging?: { limit?: number; offset?: number };
}

let served: Promise<Set<string>> | null = null;
/** The indexes the data API serves, from its own mapping. */
const gatewayIndexes = (fetchImpl: typeof fetch): Promise<Set<string>> => {
  served ??= gatewayPost(fetchImpl, { query: '{ _mapping }' }).then(({ payload }) => {
    const mapping = (payload as { data?: { _mapping?: Record<string, unknown> } }).data?._mapping ?? {};
    return new Set(Object.keys(mapping));
  }).catch((e) => { served = null; throw e; });
  return served;
};
export const forgetGatewayIndexes = () => { served = null; };

/** True when the data API can answer this read exactly: one real index, newest first, a page it can express. */
export async function gatewayServesRows(body: RowsBody, fetchImpl: typeof fetch): Promise<boolean> {
  const limit = body.paging?.limit ?? 100;
  const offset = body.paging?.offset ?? 0;
  const newestFirst = !body.sort || (body.sort.field === TIME_FIELD && (body.sort.dir ?? 'desc') === 'desc');
  const columns = body.columns ?? [];
  if (body.index_name === 'all_events' || !newestFirst || columns.length === 0 || limit > MAX_FIRST || offset > 1_000_000) return false;
  if (![body.index_name, ...columns].every((n) => NAME.test(n))) return false;
  return (await gatewayIndexes(fetchImpl)).has(body.index_name);
}

export async function rowsViaGateway(body: RowsBody, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<RowsResponse> {
  const limit = body.paging?.limit ?? 100;
  const offset = body.paging?.offset ?? 0;
  const columns = body.columns ?? [];
  const index = body.index_name;
  const filter = { AND: [{ '>=': { [TIME_FIELD]: body.window.start } }, { '<=': { [TIME_FIELD]: body.window.end } }, ...(body.filters ?? []).map(guppyClause)] };
  const query = `query VectisRows($filter: JSON) {\n  ${index}(filter: $filter, first: ${limit}, offset: ${offset}) {\n${columns.map((c) => `    ${c}`).join('\n')}\n  }\n  _aggregation {\n    ${index}(filter: $filter) { _totalCount }\n  }\n}`;
  const { payload, privacy } = await gatewayPost(fetchImpl, { query, variables: { filter } }, signal);
  if (!privacy) throw new GatewayError(502, 'The data service needs updating before the console can show its rows.');
  const wire = sanitizeUntrusted(payload) as { data?: Record<string, unknown>; errors?: { message?: string }[] };
  const rows = (wire.data?.[index] as Record<string, unknown>[] | undefined);
  if (!Array.isArray(rows)) throw new GatewayError(502, wire.errors?.[0]?.message ?? 'The data service returned no rows.');
  const counted = (wire.data?._aggregation as Record<string, { _totalCount?: number }> | undefined)?.[index]?._totalCount;
  const total = typeof counted === 'number' ? counted : null;
  return {
    index_name: index,
    columns,
    rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))),
    total,
    truncated: total === null ? rows.length >= limit : offset + rows.length < total,
    as_of: new Date().toISOString(),
    source_version: null,
  } as RowsResponse;
}

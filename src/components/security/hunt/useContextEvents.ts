import { useMemo } from 'react';
import { useApiQuery } from '@/lib/api-query';
import type { QueryState } from '@/lib/api-query';
import { ApiError } from '@/lib/vectis-kit/api';
import { useSiemApi } from '@/lib/vectis-kit/api/hooks';
import type { CatalogResponse } from '@/lib/vectis-kit/spec';
import { contextRequests, mergeSide } from './contextModel';
import type { ContextEvent, ContextSpec } from './contextModel';

export interface ContextResult {
  before: ContextEvent[];
  after: ContextEvent[];
  /** Anything left out or that could not be read, in words. An index failing does not take the others down. */
  notes: string[];
}

/**
 * The events just before and just after the moment, for the entity alone or for everything. One narrow `rows` request per place to look and per
 * side, in parallel. If some fail the page shows the rest and says which; only when every one fails is it an error.
 */
export function useContextEvents(spec: ContextSpec | null, catalog: CatalogResponse): QueryState<ContextResult, ApiError> {
  const api = useSiemApi();
  const plan = useMemo(() => (spec ? contextRequests(spec, catalog) : null), [spec, catalog]);
  return useApiQuery<ContextResult, ApiError>({
    mode: api.mode,
    scope: 'siem',
    name: 'huntContext',
    key: plan ? [JSON.stringify(plan)] : null,
    fetcher: async () => {
      if (!plan) return { before: [], after: [], notes: [] };
      const ask = (bodies: typeof plan.before) => Promise.allSettled(bodies.map(async (body) => ({ index: body.index_name, rows: (await api.call('rows', { body })).rows })));
      const [before, after] = await Promise.all([ask(plan.before), ask(plan.after)]);
      const settled = [...before, ...after];
      const failed = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
      if (settled.length > 0 && failed.length === settled.length) throw failed[0].reason;
      const answers = (side: typeof before) => side.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      const notes = [...plan.notes];
      if (failed.length > 0) notes.push(`${failed.length} of ${settled.length} reads failed, so some events may be missing from this view.`);
      return { before: mergeSide(answers(before), 'before'), after: mergeSide(answers(after), 'after'), notes };
    },
    toError: (e) => (e instanceof ApiError ? e : new ApiError(0, 'The security service could not be reached.', 'rows')),
  });
}

import type { SWRConfiguration } from 'swr';
import { createApiContext, everyMs, useApiInvalidate, useApiQuery } from '@/lib/api-query';
import type { QueryState as CoreQueryState } from '@/lib/api-query';
import type { SiemApi } from './index';
import { ApiError, createApi } from './index';
import type { CallInput } from './client';
import type { ApiMap, RouteName } from './routes';

const { Provider: SiemApiProvider, useApi: useSiemApi } = createApiContext<SiemApi>('Siem', createApi);
export { SiemApiProvider, useSiemApi };

export type QueryState<T> = CoreQueryState<T, ApiError>;

/**
 * Read data. Pass `input = null` to pause (for example until a filter is chosen).
 * Results are cached per route + body + params, and can poll with `refreshMs` (see lib/api-query).
 */
export function useSiemQuery<K extends RouteName>(
  name: K,
  input: CallInput<K> | null,
  options: { refreshMs?: number } & Pick<SWRConfiguration, 'keepPreviousData'> = {},
): QueryState<ApiMap[K][1]> {
  const api = useSiemApi();
  return useApiQuery<ApiMap[K][1], ApiError>({
    mode: api.mode,
    scope: 'siem',
    name,
    key: input === null ? null : [JSON.stringify(input.body ?? null), JSON.stringify(input.params ?? null)],
    fetcher: () => api.call(name, input as CallInput<K>),
    toError: (e) => (e instanceof ApiError ? e : new ApiError(0, 'The security service could not be reached.', name)),
    poll: options.refreshMs ? { phases: everyMs(options.refreshMs), active: () => true } : undefined,
    keepPreviousData: options.keepPreviousData,
  });
}

/** Write data, then revalidate the listed read routes. */
export function useSiemMutation<K extends RouteName>(name: K) {
  const api = useSiemApi();
  const invalidate = useApiInvalidate('siem');
  return async (input: CallInput<K>, routes: RouteName[] = []): Promise<ApiMap[K][1]> => {
    const result = await api.call(name, input);
    await invalidate(...routes);
    return result;
  };
}

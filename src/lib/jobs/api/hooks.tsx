import { createApiContext, useApiInvalidate, useApiQuery } from '@/lib/api-query';
import type { PollOptions, PollPhase } from '@/lib/api-query';
import type { JobsApi } from './client';
import { JobsApiError, createLiveApi } from './client';

const { Provider: JobsApiProvider, useApi: useJobsApi } = createApiContext<JobsApi>('Jobs', createLiveApi);
export { JobsApiProvider, useJobsApi };

/** Runs list: every 5s for 2 minutes, every 15s up to 10 minutes, then stop. */
export const RUNS_POLL: readonly PollPhase[] = [{ untilMs: 120_000, everyMs: 5_000 }, { untilMs: 600_000, everyMs: 15_000 }];
/** Run drawer: every 3s for 1 minute, every 10s up to 10 minutes, then stop. */
export const DRAWER_POLL: readonly PollPhase[] = [{ untilMs: 60_000, everyMs: 3_000 }, { untilMs: 600_000, everyMs: 10_000 }];

/**
 * Read data over the Jobs client (`key = null` pauses). Polling follows a schedule with a ceiling; see lib/api-query.
 * Cache keys are [mode, 'jobs', name, ...key], so a write can revalidate by name.
 */
export function useJobsQuery<T>(
  name: string,
  key: unknown[] | null,
  fetcher: (api: JobsApi, signal?: AbortSignal) => Promise<T>,
  options: { poll?: PollOptions<T> } = {},
) {
  const api = useJobsApi();
  return useApiQuery<T, JobsApiError>({
    mode: api.mode,
    scope: 'jobs',
    name,
    key,
    fetcher: () => fetcher(api),
    toError: (e) => (e instanceof JobsApiError ? e : new JobsApiError(0, 'The jobs service could not be reached.')),
    poll: options.poll,
    dedupe: 0,
  });
}

/** Revalidate every cached read of the named routes (after a submit or cancel). */
export const useJobsInvalidate = () => useApiInvalidate('jobs');

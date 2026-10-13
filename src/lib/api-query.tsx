/**
 * The one data-fetching core for every API client in the portal (the security console's and the Jobs one): SWR with a
 * stable cache key, optional polling that follows a schedule with a ceiling, backoff while fetches fail, no polling
 * while the browser tab is hidden, and nothing persisted (results live in the SWR memory cache only). A client file
 * supplies its API object, its error class and its cache scope; it does not copy any of this.
 *
 * Cache keys are [api mode, scope, name, ...parts], so a write can revalidate every cached read of a route by name.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

/** One step of a polling schedule: until `untilMs` after polling started, poll every `everyMs`. */
export interface PollPhase { untilMs: number; everyMs: number }
const MAX_BACKOFF_MS = 60_000;

/**
 * Wait before the next poll, or null when the ceiling is reached (stop; the user must refresh).
 * After `errors` failures in a row the wait doubles each time, up to 60s, so a failing backend is not hammered.
 */
export function nextDelay(phases: readonly PollPhase[], elapsedMs: number, errors: number): number | null {
  const phase = phases.find((p) => elapsedMs < p.untilMs);
  if (!phase) return null;
  return errors > 0 ? Math.min(MAX_BACKOFF_MS, phase.everyMs * 2 ** Math.min(errors, 16)) : phase.everyMs;
}

export const tabVisible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible';

/** A polling schedule that never ends, for data that should stay fresh while the page is open. */
export const everyMs = (ms: number): readonly PollPhase[] => [{ untilMs: Infinity, everyMs: ms }];

/** `const { Provider, useApi } = createApiContext<MyApi>('My', createMyApi)` gives <MyApiProvider> and useMyApi(). */
export function createApiContext<A>(label: string, make: () => A) {
  const Ctx = createContext<A | null>(null);
  const Provider = ({ children, api }: { children: React.ReactNode; api?: A }) => {
    const value = useMemo(() => api ?? make(), [api]);
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  };
  const useApi = (): A => {
    const api = useContext(Ctx);
    if (!api) throw new Error(`use${label}Api must be used inside <${label}ApiProvider>`);
    return api;
  };
  return { Provider, useApi };
}

export interface QueryState<T, E extends Error = Error> {
  data: T | undefined;
  error: E | undefined;
  loading: boolean;
  /** true while a refetch is in flight and `data` is the previous result */
  stale: boolean;
  /** epoch ms of the last successful fetch */
  updatedAt: number | null;
  /** polling hit its ceiling and stopped; `refresh()` starts it again */
  paused: boolean;
  /** Manual refresh. Restarts the polling clock. */
  refresh: () => Promise<T | undefined>;
}

export interface PollOptions<T> {
  /** schedule; polling stops for good after the last phase */
  phases: readonly PollPhase[];
  /** polling runs only while this is true for the latest data (for example: some run is not finished) */
  active: (data: T | undefined) => boolean;
}

interface QueryArgs<T, E extends Error> {
  mode: string;
  scope: string;
  name: string;
  /** the request-specific part of the cache key; null pauses the query */
  key: unknown[] | null;
  fetcher: () => Promise<T>;
  /** turn anything that was thrown into this client's error type */
  toError: (e: unknown) => E;
  poll?: PollOptions<T>;
  /** SWR de-duplication window in ms (default: SWR's) */
  dedupe?: number;
  keepPreviousData?: boolean;
}

export function useApiQuery<T, E extends Error>(args: QueryArgs<T, E>): QueryState<T, E> {
  const { mode, scope, name, key, fetcher, toError, poll, dedupe, keepPreviousData = true } = args;
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const keyText = JSON.stringify(key);
  // The ceiling is remembered per key, so a new key starts unpaused without resetting state in an effect.
  const [pausedFor, setPausedFor] = useState<string | null>(null);
  const paused = pausedFor === keyText;
  const started = useRef(0); // set when the key changes (effect below); never read during render
  const errors = useRef(0);
  const pausedRef = useRef(false);
  const latest = useRef<T | undefined>(undefined);
  useEffect(() => { started.current = Date.now(); errors.current = 0; pausedRef.current = false; }, [keyText]);

  const { data, error, isLoading, isValidating, mutate } = useSWR<T, unknown>(
    key === null ? null : [mode, scope, name, ...key],
    fetcher,
    {
      refreshInterval: poll
        ? (d) => {
          if (!poll.active(d) || !tabVisible()) return 0;
          const wait = nextDelay(poll.phases, Date.now() - started.current, errors.current);
          if (wait === null) { pausedRef.current = true; setPausedFor(keyText); return 0; }
          return wait;
        }
        : undefined,
      keepPreviousData, revalidateOnFocus: false, shouldRetryOnError: false,
      ...(dedupe === undefined ? {} : { dedupingInterval: dedupe }),
      onSuccess: (d) => { errors.current = 0; latest.current = d; setUpdatedAt(Date.now()); },
      onError: () => { errors.current += 1; },
    },
  );
  useEffect(() => { latest.current = data; }, [data]);

  // A hidden tab stops polling; coming back restarts it (unless it hit the ceiling).
  useEffect(() => {
    if (!poll) return undefined;
    const onVisible = () => { if (tabVisible() && !pausedRef.current && poll.active(latest.current)) void mutate(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [poll, mutate]);

  return {
    data, error: error === undefined ? undefined : toError(error), loading: isLoading, stale: isValidating && data !== undefined, updatedAt, paused,
    refresh: () => { started.current = Date.now(); errors.current = 0; pausedRef.current = false; setPausedFor(null); return mutate(); },
  };
}

/** Revalidate every cached read of the named routes in a scope (after a write). */
export function useApiInvalidate(scope: string) {
  // The config-bound mutate targets the cache this tree actually uses (the default one in production).
  const { mutate } = useSWRConfig();
  return (...names: string[]) => Promise.all(
    names.map((n) => mutate((k) => Array.isArray(k) && k[1] === scope && k[2] === n, undefined, { revalidate: true })),
  );
}

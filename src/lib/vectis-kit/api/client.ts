import type { ApiMap, RouteName} from './routes';
import { ROUTES, buildPath } from './routes';
import { sanitizeUntrusted } from '@/lib/safe-text';

/** A failed call. `status` 401/403 mean sign-in/permission; 0 means the service could not be reached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly route: RouteName,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type CallInput<K extends RouteName> = {
  body?: ApiMap[K][0];
  params?: Record<string, string>;
  signal?: AbortSignal;
};

/** The one interface the UI talks to. A live implementation and a development fixture implementation exist. */
export interface SiemApi {
  readonly mode: 'live' | 'fixtures';
  call<K extends RouteName>(name: K, input?: CallInput<K>): Promise<ApiMap[K][1]>;
}

const BASE = '/api/siem';

export function createLiveApi(fetchImpl: typeof fetch = (...a) => fetch(...a)): SiemApi {
  return {
    mode: 'live',
    async call<K extends RouteName>(name: K, input: CallInput<K> = {}): Promise<ApiMap[K][1]> {
      const def = ROUTES[name];
      let res: Response;
      try {
        res = await fetchImpl(`${BASE}/${buildPath(name, input.params)}`, {
          method: def.method,
          headers: input.body === undefined ? {} : { 'content-type': 'application/json' },
          body: input.body === undefined ? undefined : JSON.stringify(input.body),
          credentials: 'same-origin',
          signal: input.signal,
        });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        throw new ApiError(0, 'The security service could not be reached.', name);
      }
      const text = await res.text();
      let payload: unknown = undefined;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = undefined;
        }
      }
      if (!res.ok) {
        const detail = (payload as { error?: string; detail?: unknown } | undefined)?.error;
        throw new ApiError(res.status, detail ?? `Request failed (${res.status})`, name);
      }
      return sanitizeUntrusted(payload) as ApiMap[K][1];
    },
  };
}

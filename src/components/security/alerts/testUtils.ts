import { vi } from 'vitest';
import type { ApiMap, CallInput, RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';

type Override = (input: CallInput<RouteName>) => unknown;

/** The fixture API with some routes replaced, and a spy on every call. Test-only. */
let seq = 0;

/**
 * The SWR cache is process-wide and keyed by `api.mode`, so each test API gets a unique mode string. Without it one
 * test's cached or in-flight data answers the next test's identical request.
 */
export function apiWith(overrides: Partial<Record<RouteName, Override>> = {}) {
  const base = createFixtureApi(0);
  const spy = vi.fn();
  const api: SiemApi = {
    mode: `fixtures-${(seq += 1)}` as SiemApi['mode'],
    async call<K extends RouteName>(name: K, input?: CallInput<K>): Promise<ApiMap[K][1]> {
      spy(name, input);
      const o = overrides[name];
      if (o) return (await o((input ?? {}) as CallInput<RouteName>)) as ApiMap[K][1];
      return base.call(name, input);
    },
  };
  return { api, spy, callsTo: (name: RouteName) => spy.mock.calls.filter((c) => c[0] === name) };
}

/**
 * A small in-memory stand-in for next/router, installed globally by vitest.unit.setup.ts.
 * It re-renders subscribers on push/replace, so components that read `router.query` behave like the real thing.
 */
import { useSyncExternalStore } from 'react';

type Query = Record<string, string | string[] | undefined>;
interface State { pathname: string; query: Query; asPath: string }

let state: State = { pathname: '/', query: {}, asPath: '/' };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const toAsPath = (pathname: string, query: Query): string => {
  const qs = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0]! : v]]))).toString();
  return qs ? `${pathname}?${qs}` : pathname;
};

/** Set the current URL, e.g. setMockUrl('/Security?tab=alerts'). */
export function setMockUrl(url: string): void {
  const u = new URL(url, 'http://localhost');
  const query: Query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  state = { pathname: u.pathname, query, asPath: url };
  emit();
}
export const getMockUrl = (): string => state.asPath;
export const getMockQuery = (): Query => state.query;

const navigate = async (target: string | { pathname?: string; query?: Query }): Promise<boolean> => {
  if (typeof target === 'string') setMockUrl(target);
  else {
    const pathname = target.pathname ?? state.pathname;
    const query = target.query ?? {};
    state = { pathname, query, asPath: toAsPath(pathname, query) };
    emit();
  }
  return true;
};

export function useRouter() {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
  return { ...snap, isReady: true, push: navigate, replace: navigate, back: () => undefined, prefetch: async () => undefined, events: { on: () => undefined, off: () => undefined } };
}
export default { useRouter };

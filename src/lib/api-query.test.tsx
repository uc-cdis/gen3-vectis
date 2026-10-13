import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { createApiContext, everyMs, nextDelay, useApiInvalidate, useApiQuery } from './api-query';

const wrapper = ({ children }: { children: React.ReactNode }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
class TestError extends Error {}
const toError = (e: unknown) => (e instanceof TestError ? e : new TestError('wrapped'));
const base = { mode: 'test', scope: 's', name: 'n', toError };

describe('nextDelay', () => {
  const phases = [{ untilMs: 1000, everyMs: 100 }, { untilMs: 5000, everyMs: 500 }];
  it('follows the schedule and stops at the ceiling', () => {
    expect(nextDelay(phases, 0, 0)).toBe(100);
    expect(nextDelay(phases, 999, 0)).toBe(100);
    expect(nextDelay(phases, 1000, 0)).toBe(500);
    expect(nextDelay(phases, 5000, 0)).toBeNull();
  });
  it('doubles after each failure and never waits more than a minute', () => {
    expect(nextDelay(phases, 0, 1)).toBe(200);
    expect(nextDelay(phases, 0, 3)).toBe(800);
    expect(nextDelay(phases, 0, 30)).toBe(60_000);
  });
  it('everyMs never ends', () => { expect(nextDelay(everyMs(250), 10 ** 12, 0)).toBe(250); });
});

describe('createApiContext', () => {
  it('provides the api and refuses to be used outside its provider', () => {
    const { Provider, useApi } = createApiContext<{ id: string }>('Test', () => ({ id: 'made' }));
    expect(() => renderHook(() => useApi())).toThrow(/useTestApi must be used inside <TestApiProvider>/);
    expect(renderHook(() => useApi(), { wrapper: ({ children }) => <Provider>{children}</Provider> }).result.current.id).toBe('made');
    expect(renderHook(() => useApi(), { wrapper: ({ children }) => <Provider api={{ id: 'given' }}>{children}</Provider> }).result.current.id).toBe('given');
  });
});

describe('useApiQuery', () => {
  it('does nothing while the key is null, then loads', async () => {
    const fetcher = vi.fn(async () => 7);
    const { result, rerender } = renderHook(({ key }: { key: unknown[] | null }) => useApiQuery({ ...base, key, fetcher }), { wrapper, initialProps: { key: null as unknown[] | null } });
    expect(fetcher).not.toHaveBeenCalled();
    rerender({ key: ['a'] });
    await waitFor(() => expect(result.current.data).toBe(7));
    expect(result.current.updatedAt).not.toBeNull();
  });
  it('turns whatever was thrown into the client error type', async () => {
    const { result } = renderHook(() => useApiQuery({ ...base, key: [], fetcher: async () => { throw new Error('boom'); } }), { wrapper });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(TestError));
    expect(result.current.error?.message).toBe('wrapped');
  });
  it('polls only while active, and stops for good at the ceiling until refresh()', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let n = 0;
      const fetcher = vi.fn(async () => ++n);
      const poll = { phases: [{ untilMs: 350, everyMs: 100 }], active: (d: number | undefined) => d === undefined || d < 100 };
      const { result } = renderHook(() => useApiQuery({ ...base, key: [], fetcher, poll }), { wrapper });
      await waitFor(() => expect(result.current.data).toBe(1));
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(result.current.paused).toBe(true);
      const calls = fetcher.mock.calls.length;
      expect(calls).toBeGreaterThan(1);
      expect(calls).toBeLessThan(6);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(fetcher.mock.calls.length).toBe(calls);
      await act(async () => { await result.current.refresh(); });
      expect(result.current.paused).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe('useApiInvalidate', () => {
  it('revalidates cached reads of a route in its scope only', async () => {
    const a = vi.fn(async () => 'a'); const b = vi.fn(async () => 'b');
    const { result } = renderHook(() => ({
      qa: useApiQuery({ ...base, scope: 'one', name: 'x', key: [], fetcher: a }),
      qb: useApiQuery({ ...base, scope: 'two', name: 'x', key: [], fetcher: b }),
      invalidate: useApiInvalidate('one'),
    }), { wrapper });
    await waitFor(() => expect(result.current.qa.data).toBe('a'));
    await waitFor(() => expect(result.current.qb.data).toBe('b'));
    await act(async () => { await result.current.invalidate('x'); });
    expect(a.mock.calls.length).toBe(2);
    expect(b.mock.calls.length).toBe(1);
  });
});

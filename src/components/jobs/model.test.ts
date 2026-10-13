import { describe, expect, it } from 'vitest';
import { formatDuration } from '@/lib/vectis-kit/ui/format';
import { DRAWER_POLL, RUNS_POLL, anyActive, argvText, isCancellable, isTerminal, lastLines, nextDelay } from './model';
import { task } from './testUtils';

describe('model', () => {
  it('formats durations and never invents one', () => {
    expect(formatDuration('2026-10-01T10:00:00Z', '2026-10-01T10:01:23Z')).toBe('1m 23s');
    expect(formatDuration('2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')).toBe('0s'); // a real zero is real
    expect(formatDuration(null, '2026-10-01T10:00:00Z')).toBe('—');
    expect(formatDuration('2026-10-01T10:00:00Z', null)).toBe('—');
    expect(formatDuration('2026-10-01T10:00:10Z', '2026-10-01T10:00:00Z')).toBe('—');
  });
  it('only cancels active runs', () => {
    for (const s of ['queued', 'starting', 'running'] as const) expect(isCancellable(s)).toBe(true);
    for (const s of ['succeeded', 'cancelled', 'failed', 'unknown'] as const) expect(isCancellable(s)).toBe(false);
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('unknown')).toBe(false); // may still resolve, so it is polled
  });
  it('polls only runs that can still change', () => {
    expect(anyActive([task({ state: 'COMPLETE' }), task({ state: 'RUNNING' })])).toBe(true);
    expect(anyActive([task({ state: 'COMPLETE' }), task({ state: 'CANCELED' }), task({ state: 'PREEMPTED' })])).toBe(false);
    expect(anyActive([])).toBe(false);
    expect(anyActive(undefined)).toBe(false);
  });
  it('list schedule: 5s for 2 minutes, 15s to 10 minutes, then stop', () => {
    expect(nextDelay(RUNS_POLL, 0, 0)).toBe(5000);
    expect(nextDelay(RUNS_POLL, 119_999, 0)).toBe(5000);
    expect(nextDelay(RUNS_POLL, 120_000, 0)).toBe(15_000);
    expect(nextDelay(RUNS_POLL, 599_999, 0)).toBe(15_000);
    expect(nextDelay(RUNS_POLL, 600_000, 0)).toBeNull();
    expect(nextDelay(RUNS_POLL, 9_999_999, 0)).toBeNull();
  });
  it('drawer schedule: 3s for 1 minute, 10s to 10 minutes, then stop', () => {
    expect(nextDelay(DRAWER_POLL, 59_999, 0)).toBe(3000);
    expect(nextDelay(DRAWER_POLL, 60_000, 0)).toBe(10_000);
    expect(nextDelay(DRAWER_POLL, 600_000, 0)).toBeNull();
  });
  it('doubles the wait after each failure, up to 60s, and still obeys the ceiling', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => nextDelay(RUNS_POLL, 0, n))).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
    expect(nextDelay(RUNS_POLL, 130_000, 1)).toBe(30_000);
    expect(nextDelay(RUNS_POLL, 130_000, 50)).toBe(60_000);
    expect(nextDelay(RUNS_POLL, 600_000, 3)).toBeNull();
    expect(nextDelay(RUNS_POLL, 0, 0)).toBe(5000); // a success resets the count
  });
  it('keeps argument boundaries visible', () => {
    expect(argvText(['echo', 'a b', ''])).toBe('echo "a b" ""');
    expect(lastLines('a\nb\nc\n\n', 2)).toBe('b\nc');
  });
});

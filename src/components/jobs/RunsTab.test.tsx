import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobsApiError } from '@/lib/jobs/api';
import type { RunsQuery } from '@/lib/jobs/api';
import RunsTab from './RunsTab';
import { apiWith, renderJobs, task } from './testUtils';

const FAST = (everyMs: number) => [{ untilMs: 600_000, everyMs }];
const listing = (tasks = [task()], next: string | null = null) => vi.fn(async (_q: RunsQuery) => ({ runs: tasks, next_page_token: next }));

describe('RunsTab', () => {
  it('shows state as text, job, submitter, created and duration; missing times are dashes', async () => {
    const done = task({ id: 'a', state: 'COMPLETE', name: 'Alpha' }, [{ start_time: '2026-10-01T10:00:00Z', end_time: '2026-10-01T10:01:23Z', logs: [] }]);
    const bare = task({ id: 'b', state: 'RUNNING', name: 'Bravo', creation_time: null, tags: {} });
    renderJobs(<RunsTab onOpen={() => undefined} />, apiWith({ listRuns: listing([done, bare]) }));
    const rows = await screen.findAllByRole('row');
    const a = within(rows.find((r) => r.textContent?.includes('Alpha'))!);
    expect(a.getByText('Succeeded')).toBeInTheDocument();
    expect(a.getByTestId('backend-state')).toHaveTextContent('COMPLETE'); // the runner's own word, secondary
    expect(a.getByText('hello')).toBeInTheDocument();
    expect(a.getByText('me')).toBeInTheDocument();
    expect(a.getByText('1m 23s')).toBeInTheDocument();
    const b = within(rows.find((r) => r.textContent?.includes('Bravo'))!);
    expect(b.getByText('Running')).toBeInTheDocument();
    expect(b.getAllByText('—').length).toBeGreaterThanOrEqual(4); // job, submitter, created, duration
  });
  it('opens a run from the row and from the name button', async () => {
    const onOpen = vi.fn();
    renderJobs(<RunsTab onOpen={onOpen} />, apiWith({ listRuns: listing([task({ id: 'a', name: 'Alpha' })]) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open run Alpha' }));
    expect(onOpen).toHaveBeenCalledWith('a');
    expect(onOpen).toHaveBeenCalledTimes(1); // the button does not also fire the row handler
  });
  it('sends the state filter and, after a 300ms pause, the name prefix', async () => {
    const listRuns = listing();
    renderJobs(<RunsTab onOpen={() => undefined} />, apiWith({ listRuns }));
    await screen.findByText('Test run');
    await userEvent.type(screen.getByLabelText('Search by name'), 'Log');
    expect(listRuns.mock.calls.some(([q]) => q.name_prefix)).toBe(false); // not on every keystroke
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith(expect.objectContaining({ name_prefix: 'Log' })));
    await userEvent.click(screen.getAllByLabelText('State')[0]);
    await userEvent.click(await screen.findByText('Running'));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'running', name_prefix: 'Log' })));
  });
  it('loads ONE page of 50 (summary) and fetches another only when Load older is clicked', async () => {
    const calls: Array<{ page_token?: string; page_size?: number; detail?: string }> = [];
    const listRuns = vi.fn(async (q: RunsQuery) => {
      calls.push(q);
      return q.page_token ? { runs: [task({ id: 'p2', name: 'Older run', state: 'COMPLETE' })], next_page_token: null } : { runs: [task({ id: 'p1', name: 'Newest run', state: 'RUNNING' })], next_page_token: 'tok2' };
    });
    renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST(30)} />, apiWith({ listRuns }));
    await screen.findByText('Newest run');
    expect(calls[0]).toMatchObject({ detail: 'summary', page_size: 50 });
    await new Promise((r) => setTimeout(r, 250)); // polling keeps running; it must never page
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.every((c) => c.page_token === undefined)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await screen.findByText('Older run');
    expect(screen.getByText('Newest run')).toBeInTheDocument(); // appended, not replaced
    expect(calls.filter((c) => c.page_token === 'tok2')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(calls.filter((c) => c.page_token !== undefined)).toHaveLength(1); // polling does not fetch it again
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });
  it('writes nothing to browser storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    renderJobs(<RunsTab onOpen={() => undefined} />, apiWith({ listRuns: listing() }));
    await screen.findByText('Test run');
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
  it('stops at the ceiling, says "Paused: refresh to resume", and restarts on manual refresh', async () => {
    const listRuns = listing([task({ state: 'RUNNING' })]);
    renderJobs(<RunsTab onOpen={() => undefined} schedule={[{ untilMs: 150, everyMs: 20 }]} />, apiWith({ listRuns }));
    await waitFor(() => expect(screen.getByTestId('refresh-note')).toHaveTextContent('Paused: refresh to resume'));
    const n = listRuns.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(listRuns.mock.calls.length).toBe(n);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh runs' }));
    await waitFor(() => expect(listRuns.mock.calls.length).toBeGreaterThan(n + 2)); // clock restarted
    await waitFor(() => expect(screen.getByTestId('refresh-note')).toHaveTextContent('Paused'));
  });
  it('stops polling when the user leaves the Runs tab (unmount)', async () => {
    const listRuns = listing([task({ state: 'RUNNING' })]);
    const { unmount } = renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST(20)} />, apiWith({ listRuns }));
    await waitFor(() => expect(listRuns.mock.calls.length).toBeGreaterThan(2));
    unmount();
    const n = listRuns.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(listRuns.mock.calls.length).toBe(n);
  });
  it('backs off while fetches keep failing and shows the error', async () => {
    let fail = false;
    const listRuns = vi.fn(async (_q: RunsQuery) => { if (fail) throw new JobsApiError(503, 'down'); return { runs: [task({ state: 'RUNNING' })], next_page_token: null }; });
    renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST(10)} />, apiWith({ listRuns }));
    await screen.findByText('Test run');
    fail = true;
    const before = listRuns.mock.calls.length;
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    const during = listRuns.mock.calls.length - before;
    expect(during).toBeLessThan(8); // 10ms polling would be ~40 calls; doubling keeps it to a handful
    expect(screen.getByText('Test run')).toBeInTheDocument(); // last good data stays visible
  });
  it('auto-refreshes while a run is active', async () => {
    const listRuns = listing([task({ state: 'RUNNING' })]);
    renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST(40)} />, apiWith({ listRuns }));
    await waitFor(() => expect(listRuns.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(screen.getByTestId('refresh-note')).toHaveTextContent(/refreshing automatically/);
  });
  it('does not auto-refresh when every run is finished', async () => {
    const listRuns = listing([task({ state: 'COMPLETE' }), task({ id: 'x', state: 'CANCELED' })]);
    renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST(30)} />, apiWith({ listRuns }));
    await screen.findAllByText('Test run');
    await new Promise((r) => setTimeout(r, 250));
    expect(listRuns).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh runs' })); // manual refresh still works
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(2));
  });
  it('does not auto-refresh while the browser tab is hidden', async () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const listRuns = listing([task({ state: 'RUNNING' })]);
    renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST(30)} />, apiWith({ listRuns }));
    await screen.findAllByText('Test run');
    await new Promise((r) => setTimeout(r, 250));
    expect(listRuns).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it('shows the service line when available and stays quiet when it fails', async () => {
    renderJobs(<RunsTab onOpen={() => undefined} />, apiWith({ listRuns: listing(), serviceInfo: async () => ({ name: 'TES', version: '1.1' }) }));
    expect(await screen.findByTestId('service-line')).toHaveTextContent('Service: TES 1.1');
  });
  it('is not blocked by a failing service-info, and shows list errors', async () => {
    renderJobs(<RunsTab onOpen={() => undefined} />, apiWith({ listRuns: listing(), serviceInfo: async () => { throw new JobsApiError(500, 'x'); } }));
    await screen.findByText('Test run');
    expect(screen.queryByTestId('service-line')).toBeNull();
    expect(screen.queryByTestId('error-state')).toBeNull();
  });
  it('shows an empty state', async () => {
    renderJobs(<RunsTab onOpen={() => undefined} />, apiWith({ listRuns: listing([]) }));
    expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
  });
});

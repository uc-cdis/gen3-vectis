import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobsApiError } from '@/lib/jobs/api';
import type { Run } from '@/lib/jobs/model';
import RunDrawer from './RunDrawer';
import { apiWith, execLog, renderJobs, task } from './testUtils';

const FAST = [{ untilMs: 600_000, everyMs: 30 }];
const show = (t: Run, extra = {}) => renderJobs(<RunDrawer id={t.id} onClose={() => undefined} schedule={FAST} />, apiWith({ getRun: vi.fn(async () => t), ...extra }));
const log = (logs: unknown[], extra: Record<string, unknown> = {}) => [{ start_time: '2026-10-01T10:00:01Z', end_time: '2026-10-01T10:00:05Z', logs, outputs: [], system_logs: [], ...extra }];

describe('RunDrawer', () => {
  it('draws a single-executor run as inputs -> executor -> outputs, in an ordered list', async () => {
    show(task({}, log([execLog({ exit_code: 0 })])));
    const flow = await screen.findByRole('list', { name: /Steps of Test run/ });
    const items = Array.from(flow.children) as HTMLElement[];
    expect(items.map((i) => i.getAttribute('data-node'))).toEqual(['inputs', 'step', 'outputs']);
    expect(items[1]).toHaveAttribute('data-status', 'success');
    expect(items[1]).toHaveTextContent('Succeeded (exit 0)');
    expect(items[1]).toHaveTextContent('alpine:3.20');
    expect(items[1]).toHaveTextContent('echo hi');
  });
  it('draws three executors with success, failure and neutral nodes', async () => {
    const t = task({
      state: 'EXECUTOR_ERROR',
      executors: [{ image: 'a', command: ['x'] }, { image: 'b', command: ['y'] }, { image: 'c', command: ['z'] }],
    }, log([execLog({ exit_code: 0 }), execLog({ exit_code: 3, stderr: 'boom\nlast line' }), execLog({ exit_code: null, end_time: null })]));
    show(t);
    const flow = await screen.findByRole('list', { name: /Steps of/ });
    const ex = (Array.from(flow.children) as HTMLElement[]).filter((i) => i.getAttribute('data-node') === 'step');
    expect(ex.map((i) => i.getAttribute('data-status'))).toEqual(['success', 'failure', 'neutral']);
    expect(ex[1]).toHaveTextContent('Failed (exit 3)');
    expect(ex[2]).toHaveTextContent('Exit code: —');
    const banner = screen.getByTestId('failure-banner');
    expect(banner).toHaveTextContent('Step 2 exited with code 3');
    expect(banner).toHaveTextContent('last line');
  });
  it('shows system logs for a system error, and missing times as dashes', async () => {
    show(task({ state: 'SYSTEM_ERROR', creation_time: null }, log([], { start_time: null, end_time: null, system_logs: ['scheduler gave up'] })));
    expect(await screen.findByTestId('failure-banner')).toHaveTextContent('scheduler gave up');
    expect(screen.getByText('Duration').nextElementSibling).toHaveTextContent('—');
  });
  it('shows the neutral state with the runner\'s own word as secondary text', async () => {
    show(task({ state: 'PREEMPTED' }, log([execLog({ exit_code: null, end_time: null })])));
    expect(await screen.findByTestId('state-badge')).toHaveTextContent('Failed');
    expect(screen.getByTestId('backend-state')).toHaveTextContent('PREEMPTED');
    expect(screen.getByTestId('failure-banner')).toHaveTextContent('The run failed');
  });
  it('renders hostile log text as text, never as HTML', async () => {
    const { container } = renderJobs(<RunDrawer id="t-1" onClose={() => undefined} />, apiWith({
      getRun: async () => task({ name: '<img src=x onerror=alert(1)>' }, log([execLog({ stdout: '<script>alert(1)</script><b>bold</b>', stderr: '<img src=x onerror=alert(2)>' })], { system_logs: ['<svg onload=alert(3)>'] })),
    }));
    expect(await screen.findAllByText(/<script>alert\(1\)<\/script>/)).not.toHaveLength(0);
    expect(document.body.querySelector('script, img, svg[onload], b')).toBeNull();
    expect(container.ownerDocument.body.innerHTML).not.toContain('<script>alert');
  });
  it('shows stdout and stderr per executor, the truncated note, and Copy', async () => {
    show(task({ executors: [{ image: 'a', command: ['x'] }, { image: 'b', command: ['y'] }] }, log([execLog({ stdout: 'x'.repeat(70_000) }), execLog({ stdout: 'out two', stderr: 'err two' })])));
    expect(await screen.findByLabelText('Step 1 stdout')).toHaveTextContent('xxxx');
    expect(screen.getByText(/truncated by the server/)).toBeInTheDocument();
    expect(screen.getByLabelText('Step 1 stderr')).toHaveTextContent('(empty)');
    expect(screen.getByRole('button', { name: 'Copy Step 1 stdout' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Step 2' }));
    expect(await screen.findByLabelText('Step 2 stderr')).toHaveTextContent('err two');
  });
  it('shows output size when known and a dash otherwise', async () => {
    show(task({ outputs: [{ path: '/a', url: 's3://b/a' }, { path: '/b', url: 's3://b/b' }] }, log([execLog()], { outputs: [{ url: 's3://b/a', path: '/a', size_bytes: '48213' }] })));
    const table = await screen.findByRole('table', { name: 'Outputs' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('48.2 KB');
    expect(rows[2]).toHaveTextContent('—');
    expect(within(table).getAllByRole('button', { name: 'Copy output url' })).toHaveLength(2);
  });
  it('copies the run id button is present', async () => {
    show(task());
    expect(await screen.findByRole('button', { name: 'Copy run id' })).toBeInTheDocument();
  });
});

describe('cancel', () => {
  it.each(['QUEUED', 'INITIALIZING', 'RUNNING', 'PAUSED', 'CANCELING'] as const)('is offered for %s (TES state, mapped to queued/starting/running)', async (state) => {
    show(task({ state }));
    expect(await screen.findByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
  });
  it.each(['COMPLETE', 'EXECUTOR_ERROR', 'SYSTEM_ERROR', 'CANCELED', 'PREEMPTED', 'UNKNOWN'] as const)('is not offered for %s', async (state) => {
    show(task({ state }));
    await screen.findByText('Test run');
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull();
  });
  it('asks to confirm first and cancels only after confirming', async () => {
    const cancelRun = vi.fn(async () => undefined);
    show(task({ state: 'RUNNING' }), { cancelRun });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    const dlg = await screen.findByRole('dialog', { name: 'Cancel this run?' });
    expect(cancelRun).not.toHaveBeenCalled();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep running' }));
    expect(cancelRun).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Cancel this run?' })).getByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(cancelRun).toHaveBeenCalledWith('t-1'));
  });
  it('explains a 403', async () => {
    show(task({ state: 'RUNNING' }), { cancelRun: async () => { throw new JobsApiError(403, 'no'); } });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Cancel this run?' })).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByTestId('cancel-error')).toHaveTextContent('not allowed to cancel');
  });
});

describe('refresh', () => {
  it('polls while active and stops once the run is terminal', async () => {
    let n = 0;
    const getRun = vi.fn(async () => task({ state: (n += 1) < 3 ? 'RUNNING' : 'COMPLETE' }));
    renderJobs(<RunDrawer id="t-1" onClose={() => undefined} schedule={FAST} />, apiWith({ getRun }));
    await waitFor(() => expect(screen.getByTestId('state-badge')).toHaveTextContent('Succeeded'));
    const calls = getRun.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(getRun.mock.calls.length).toBe(calls);
  });
  it('stops at the ceiling with a paused note, and a manual refresh restarts it', async () => {
    const getRun = vi.fn(async () => task({ state: 'RUNNING' }));
    renderJobs(<RunDrawer id="t-1" onClose={() => undefined} schedule={[{ untilMs: 150, everyMs: 20 }]} />, apiWith({ getRun }));
    expect(await screen.findByTestId('paused-note')).toHaveTextContent('Paused: refresh to resume');
    const n = getRun.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(getRun.mock.calls.length).toBe(n);
    await userEvent.click(within(screen.getByTestId('paused-note')).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(getRun.mock.calls.length).toBeGreaterThan(n + 2));
  });
  it('stops polling when the drawer is closed', async () => {
    const getRun = vi.fn(async () => task({ state: 'RUNNING' }));
    const { unmount } = renderJobs(<RunDrawer id="t-1" onClose={() => undefined} schedule={FAST} />, apiWith({ getRun }));
    await waitFor(() => expect(getRun.mock.calls.length).toBeGreaterThan(2));
    unmount();
    const n = getRun.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(getRun.mock.calls.length).toBe(n);
  });
  it('says when a run is not found', async () => {
    renderJobs(<RunDrawer id="nope" onClose={() => undefined} />, apiWith({ getRun: async () => { throw new JobsApiError(404, 'nf'); } }));
    expect(await screen.findByText(/This run was not found/)).toBeInTheDocument();
  });
});

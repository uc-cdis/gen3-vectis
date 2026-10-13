import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig, mutate } from 'swr';
import { ApiError } from '@/lib/vectis-kit/api';
import type { CallInput, RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { HealthResponse, QuarantineResponse } from '@/lib/vectis-kit/spec';
import { renderSecurity } from '../testing/render';
import HealthTab, { HEALTH_REFRESH_MS } from '../tabs/HealthTab';
import { QUARANTINE_WINDOW_HOURS } from './QuarantinePanel';

beforeEach(async () => { await mutate(() => true, undefined, { revalidate: false }); });
afterEach(() => { vi.useRealTimers(); });

type Override = (input: CallInput<RouteName>, base: SiemApi) => unknown;
function wrap(overrides: Partial<Record<RouteName, Override>>, scenario?: 'healthy') {
  const base = createFixtureApi(0, scenario ? { scenario } : {});
  const calls: { name: RouteName; input: CallInput<RouteName> | undefined }[] = [];
  const api: SiemApi & { calls: typeof calls } = {
    mode: 'fixtures', calls,
    async call(name, input) {
      calls.push({ name, input: input as CallInput<RouteName> | undefined });
      const o = overrides[name];
      if (o) return (await o(input as CallInput<RouteName>, base)) as never;
      return base.call(name, input);
    },
  };
  return api;
}
const mount = (api?: SiemApi) => renderSecurity(<SWRConfig value={{ dedupingInterval: 0 }}><HealthTab /></SWRConfig>, { url: '/Security?tab=health', api });
const withHealth = (patch: (h: HealthResponse) => HealthResponse): Override => async (_i, base) => patch(await base.call('health'));
const rowOf = (name: string) => {
  const table = screen.getByRole('table', { name: /^(graph|raw)/.test(name) ? 'Queues' : 'Sources' });
  return within(table).getByText(name).closest('tr') as HTMLElement;
};

describe('Pipeline health: sources', () => {
  it('labels stale as STALE and unconfigured sources as UNMEASURED, never OK', async () => {
    mount();
    await screen.findByText('waf');
    expect(within(rowOf('waf')).getByText('OK')).toBeInTheDocument();
    expect(within(rowOf('f5')).getByText('STALE')).toBeInTheDocument();
    expect(within(rowOf('f5')).queryByText('OK')).toBeNull();
    for (const s of ['revproxy']) {
      const row = rowOf(s);
      expect(within(row).getByText('UNMEASURED')).toBeInTheDocument();
      expect(within(row).getAllByTestId('unmeasured').length).toBeGreaterThanOrEqual(3);
      expect(within(row).queryByText('OK')).toBeNull();
      expect(within(row).queryByText('STALE')).toBeNull();
      // no event counts are invented: unmeasured, not 0
            expect(within(row).queryByText('0')).toBeNull();
    }
    // a measured zero is still shown as 0
    expect(within(rowOf('f5')).getAllByText('0')).toHaveLength(2);
    expect(screen.getAllByText('OK')).toHaveLength(1);
  });

  it('shows the last event both relative and absolute, and one quiet updated-at line with no polling chatter', async () => {
    mount();
    await screen.findByText('waf');
    expect(within(rowOf('waf')).getByText(/ago/)).toBeInTheDocument();
    expect(within(rowOf('waf')).getByText(/\(.*20\d\d.*\)/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('health-freshness')).toHaveTextContent(/^Updated .*20\d\d/));
    expect(screen.getByTestId('health-freshness')).not.toHaveTextContent(/every \d+ seconds|Data as of|Last refreshed/);
  });

  it('explains an unmeasured source in one short line and still shows its last event and counts when it has them', async () => {
    mount();
    await screen.findByText('waf');
    const squid = rowOf('squid');
    expect(within(squid).getByTestId('unmeasured-reason')).toHaveTextContent('No freshness expectation configured for this source. Set SIEM_SOURCE_EXPECTATIONS.');
    expect(within(squid).getByText('840')).toBeInTheDocument();
    expect(within(squid).getByText('12')).toBeInTheDocument();
    expect(within(squid).getByText(/ago/)).toBeInTheDocument();
    expect(within(rowOf('revproxy')).getByTestId('unmeasured-reason')).toHaveTextContent(/cannot be evaluated/);
    expect(within(rowOf('waf')).queryByTestId('unmeasured-reason')).toBeNull();
  });

  it('shows service notes only when there are any', async () => {
    mount(wrap({ health: withHealth((h) => ({ ...h, notes: ['rollups are 3 minutes behind'] })) }));
    expect(await screen.findByLabelText('Notes from the service')).toHaveTextContent('rollups are 3 minutes behind');
  });
});

describe('Pipeline health: queues', () => {
  it('lists name, role, depth, consumers and rates; an empty failures queue is not highlighted', async () => {
    mount();
    await screen.findByText('graph.ingest.tenant1');
    const row = rowOf('graph.ingest.tenant1');
    for (const t of ['Ingest', '14', '1', '22.0', '23.5']) expect(within(row).getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.queryByText('FAILING')).toBeNull();
    expect(screen.queryByText('Messages are failing')).toBeNull();
    expect(rowOf('graph.ingest.tenant1.failures')).not.toHaveAttribute('data-failing');
  });

  it('highlights a failures queue with depth above zero and explains it', async () => {
    mount(wrap({ health: withHealth((h) => ({ ...h, queues: h.queues.map((q) => (q.role === 'failures' ? { ...q, depth: 7 } : q)) })) }));
    const alert = await screen.findByText('Messages are failing');
    expect(alert.closest('[role="alert"]')).toHaveTextContent(/holds 7 messages/);
    expect(alert.closest('[role="alert"]')).toHaveTextContent(/could not process/);
    const row = rowOf('graph.ingest.tenant1.failures');
    expect(row).toHaveAttribute('data-failing', 'true');
    expect(within(row).getByText('FAILING')).toBeInTheDocument();
    expect(rowOf('graph.ingest.tenant1')).not.toHaveAttribute('data-failing');
  });

  it('shows an unreported depth as unmeasured, not zero, and does not flag it', async () => {
    mount(wrap({ health: withHealth((h) => ({ ...h, queues: h.queues.map((q) => (q.role === 'failures' ? { ...q, depth: null, consumers: null } : q)) })) }));
    await screen.findByText('graph.ingest.tenant1.failures');
    const row = rowOf('graph.ingest.tenant1.failures');
    expect(within(row).getAllByTestId('unmeasured').length).toBeGreaterThanOrEqual(2);
    expect(row).not.toHaveAttribute('data-failing');
  });
});

describe('Pipeline health: quarantine is read only', () => {
  const forbidden = /replay|purge|delete|remove|requeue|retry/i;
  const quarantineCalls = (api: ReturnType<typeof wrap>) => api.calls.filter((c) => c.name === 'quarantine');

  it('defaults to the last 36 hours and sends that window to the service', async () => {
    const api = wrap({});
    mount(api);
    expect(await screen.findByTestId('quarantine-count')).toHaveTextContent('3');
    expect(screen.getByTestId('quarantine-summary')).toHaveTextContent('quarantined in the last 36 hours');
    const first = quarantineCalls(api)[0]!;
    expect(first.input?.body).toMatchObject({ window_hours: 36, older: false });
    expect(QUARANTINE_WINDOW_HOURS).toBe(36);
  });

  it('groups by reason with count, timing, a plain-language hint and a sample key; records stay collapsed', async () => {
    mount();
    const group = await screen.findByTestId('quarantine-group');
    expect(group).toHaveTextContent('A number was too large for its column type.');
    expect(group).toHaveTextContent('3 records');
    expect(group).toHaveTextContent(/seen|first/);
    expect(group).toHaveTextContent('e.g. raw/gdc_f5/2026/10/12/example-0.log.gz');
    expect(within(group).getByRole('button', { name: 'Show records' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: 'Quarantined records' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Investigate/ })).toHaveLength(0);
  });

  it('shows the records of a group on request, pages them 10 at a time, and keeps Investigate', async () => {
    const api = wrap({
      quarantine: (i, base) => {
        const body = i.body as { reason?: string; paging?: { offset?: number; limit?: number } };
        if (!body.reason) return base.call('quarantine', i as never);
        const { offset = 0, limit = 10 } = body.paging ?? {};
        const records = Array.from({ length: Math.min(limit, 25 - offset) }, (_, k) => ({ key: `q-${offset + k}`, raw_key: `raw/${offset + k}`, source: 's', reason: body.reason!, quarantined_at: null }));
        return { records, total: 25, groups: [] } satisfies QuarantineResponse;
      },
    });
    mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Show records' }));
    expect(await screen.findByRole('button', { name: 'Investigate q-0' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Investigate/ })).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('button', { name: 'Investigate q-10' })).toBeInTheDocument();
    const last = quarantineCalls(api).pop()!;
    expect(last.input?.body).toMatchObject({ older: false, paging: { limit: 10, offset: 10 } });
    await userEvent.click(screen.getByRole('button', { name: 'Hide records' }));
    expect(screen.queryByRole('table', { name: 'Quarantined records' })).toBeNull();
  });

  it('shows a calm positive state, not a table, when nothing is quarantined in the window, with the older count', async () => {
    mount(wrap({}, 'healthy'));
    const clear = await screen.findByTestId('quarantine-clear');
    expect(clear).toHaveTextContent('No quarantined records in the last 36 hours');
    expect(screen.queryByTestId('quarantine-count')).toBeNull();
    expect(screen.queryByRole('table', { name: 'Quarantined records' })).toBeNull();
    expect(screen.queryByTestId('quarantine-group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show older records (53)' })).toBeInTheDocument();
  });

  it('fetches older records only when asked, labelled as older', async () => {
    const api = wrap({}, 'healthy');
    mount(api);
    await screen.findByTestId('quarantine-clear');
    expect(quarantineCalls(api).some((c) => (c.input?.body as { older?: boolean } | undefined)?.older)).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show older records (53)' }));
    const groups = await screen.findByLabelText('Older quarantine groups');
    expect(groups).toHaveTextContent('The writer rejected the batch (schema mismatch)');
    expect(screen.getByText(/Older than 36 hours/)).toBeInTheDocument();
    expect(quarantineCalls(api).some((c) => (c.input?.body as { older?: boolean } | undefined)?.older === true)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Hide older records' }));
    expect(screen.queryByLabelText('Older quarantine groups')).toBeNull();
  });

  it('says the older count is unknown rather than inventing one, and hides the control when there are none', async () => {
    const { unmount } = mount(wrap({ health: withHealth((h) => ({ ...h, quarantine_count: 0, quarantine_reasons: [], quarantine_older_count: null })) }));
    expect(await screen.findByRole('button', { name: 'Show older records (count unknown)' })).toBeInTheDocument();
    unmount();
    mount(wrap({ health: withHealth((h) => ({ ...h, quarantine_count: 0, quarantine_reasons: [], quarantine_older_count: 0 })) }));
    await screen.findByTestId('quarantine-clear');
    expect(screen.queryByRole('button', { name: /older records/ })).toBeNull();
  });

  it('shows an unreported quarantine count as unmeasured', async () => {
    mount(wrap({ health: withHealth((h) => ({ ...h, quarantine_count: null, quarantine_reasons: [] })) }));
    const summary = await screen.findByTestId('quarantine-summary');
    expect(within(summary).getByTestId('unmeasured')).toBeInTheDocument();
    expect(within(summary).queryByTestId('quarantine-count')).toBeNull();
    expect(within(summary).queryByTestId('quarantine-clear')).toBeNull();
  });

  it('is honest when only the newest records were read', async () => {
    mount(wrap({ quarantine: async (i, base) => ({ ...(await base.call('quarantine', i as never)), truncated: true }) }));
    expect(await screen.findByText(/lower bound/)).toBeInTheDocument();
  });

  it('opens a detail panel with the raw key, a copy control, source, reason and time, and offers no write action anywhere', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Show records' }));
    await userEvent.click((await screen.findAllByRole('button', { name: /^Investigate / }))[0]!);
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByTestId('detail-raw-key')).toHaveTextContent('raw/gdc_f5/2026/10/12/example-0.log.gz');
    expect(within(panel).getByRole('button', { name: 'Copy raw key' })).toBeInTheDocument();
    expect(within(panel).getByText('f5')).toBeInTheDocument();
    expect(within(panel).getByText(/value too large to fit in C integer type/)).toBeInTheDocument();
    expect(within(panel).getByText(/read only/)).toHaveTextContent(/deliberate operator action done outside this console/);
    expect(screen.queryAllByRole('button', { name: forbidden })).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: forbidden })).toHaveLength(0);
  });

  it('has no replay, purge or delete control anywhere on the page', async () => {
    mount();
    await screen.findByTestId('quarantine-group');
    expect(screen.queryAllByRole('button', { name: forbidden })).toHaveLength(0);
  });

  it('renders hostile quarantine text as text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const rec = { key: 'q-9', raw_key: `raw/${evil}`, source: evil, reason: evil, quarantined_at: null };
    const { container } = mount(wrap({ quarantine: () => ({ total: 1, records: [rec], groups: [{ reason: evil, hint: evil, count: 1, sample_key: evil }] } satisfies QuarantineResponse) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Show records' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Investigate q-9' }));
    await screen.findByRole('dialog');
    expect(container.ownerDocument.querySelector('img')).toBeNull();
    expect(within(screen.getByRole('dialog')).getByTestId('detail-raw-key')).toHaveTextContent(`raw/${evil}`);
    expect(within(screen.getByRole('dialog')).getByTestId('unmeasured')).toBeInTheDocument(); // no time recorded
  });
});

describe('Pipeline health: states and polling', () => {
  it('shows an error state when the API rejects, then recovers on retry', async () => {
    let fail = true;
    mount(wrap({ health: (_i, base) => (fail ? Promise.reject(new ApiError(0, 'down', 'health')) : base.call('health')) }));
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/could not be reached/);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('waf')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is reported', async () => {
    mount(wrap({ health: () => ({ sources: [], queues: [], as_of: '2026-10-09T18:00:00Z' } satisfies HealthResponse) }));
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(/No pipeline data/);
  });

  it('polls the health route every 30 seconds (refreshMs) and shows a manual refresh', async () => {
    expect(HEALTH_REFRESH_MS).toBe(30_000);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = wrap({});
    mount(api);
    await screen.findByText('waf');
    const count = () => api.calls.filter((c) => c.name === 'health').length;
    const before = count();
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_REFRESH_MS - 5_000); });
    expect(count()).toBe(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await waitFor(() => expect(count()).toBeGreaterThan(before));
    const after = count();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(count()).toBeGreaterThan(after));
  });
});

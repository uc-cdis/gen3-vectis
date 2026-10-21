import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { ApiError } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { CatalogResponse, ColumnMeta } from '@/lib/vectis-kit/spec';
import { FIXTURES } from '@/lib/vectis-kit/api/fixtureApi';
import { renderSecurity } from '../testing/render';

const charts: { option: Record<string, any> }[] = [];
vi.mock('@gen3/frontend', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ReactECharts: (p: { option: Record<string, any> }) => { charts.push(p); return <div data-testid="echart" />; },
}));

import { ActivityHeatmap, defaultHeatmapDims, heatmapColumns } from './ActivityHeatmap';

const catalog = FIXTURES['catalog.response'] as CatalogResponse;
const all = catalog.indexes.find((i) => i.index_name === 'all_events')!;
const WINDOW = { start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z' };

type Call = { name: RouteName; body?: Record<string, any> };
function spy(over: Partial<Record<RouteName, (b: any) => unknown>> = {}): { api: SiemApi; calls: Call[] } {
  const base = createFixtureApi(0);
  const calls: Call[] = [];
  return {
    calls,
    api: { mode: 'fixtures', call: async (name, input) => { calls.push({ name, body: (input as { body?: Record<string, any> } | undefined)?.body }); const o = over[name]; return o ? (o((input as { body?: unknown })?.body) as never) : base.call(name, input); } },
  };
}
const mount = (api: SiemApi, columns: readonly ColumnMeta[] = all.columns, filters: any[] = []) =>
  renderSecurity(<ActivityHeatmap indexName="all_events" columns={columns} window={WINDOW} filters={filters} />, { api, url: '/Security?tab=hunt' });

beforeEach(() => { charts.length = 0; });
// Mantine Select labels both its input and its list; the input opens it.
const select = (label: string) => screen.getAllByLabelText(label).find((e) => e.tagName === 'INPUT')!;
/** Open one Select and pick from its own list (both Selects keep a list in the page). */
const choose = async (label: string, option: string) => {
  const input = select(label);
  await userEvent.click(input);
  const list = document.getElementById(input.getAttribute('aria-controls')!)!;
  await userEvent.click(within(list).getByRole('option', { name: option, hidden: true }));
};

describe('heat map dimensions', () => {
  it('start as source address down and outcome across, and never offer a PII or numeric column', () => {
    expect(defaultHeatmapDims(all.columns)).toEqual({ rows: 'src_ip', cols: 'outcome' });
    const offered = heatmapColumns([...all.columns, { name: 'user_hash', label: 'User', type: 'string', pii: true, filterable: true } as ColumnMeta]).map((c) => c.name);
    expect(offered).not.toContain('user_hash');
    expect(offered).not.toContain('event_time');
    expect(offered).not.toContain('status_code');
    expect(offered).toContain('index_name');
  });
  it('fall back sensibly when the usual columns are absent', () => {
    const only = all.columns.filter((c) => ['index_name', 'severity'].includes(c.name));
    const d = defaultHeatmapDims(only);
    expect(d.rows).toBe('index_name');
    expect(d.cols).toBe('severity');
  });
});

describe('ActivityHeatmap', () => {
  it('asks for counts by the two columns over the given window and filters, and draws them', async () => {
    const { api, calls } = spy();
    const filters = [{ field: 'severity', op: 'eq', value: 'high' }];
    mount(api, all.columns, filters);
    await screen.findByTestId('echart');
    const body = calls.find((c) => c.name === 'aggregate')!.body!;
    expect(body).toEqual({ index_name: 'all_events', window: WINDOW, filters, group_by: ['src_ip', 'outcome'], top_n: 15 });
    const o = charts.at(-1)!.option;
    expect(o.series[0].type).toBe('heatmap');
    expect(o.yAxis.data[0]).toBe('203.0.113.50');
    expect(o.xAxis.data).toContain('block');
  });

  it('says how much of the window is drawn, and offers the numbers as a table', async () => {
    mount(spy().api);
    await screen.findByTestId('echart');
    expect(screen.getAllByText(/events/).some((e) => /of \d[\d,]* events/.test(e.textContent ?? ''))).toBe(true);
    expect(screen.getByLabelText(/Source IP by Outcome, data table/)).toBeInTheDocument();
  });

  it('asks again when either column is changed', async () => {
    const { api, calls } = spy({ aggregate: (b) => ({ index_name: 'all_events', group_by: b.group_by, rows: [{ values: ['a', 'b'], count: 1 }], total: 1, truncated: false, as_of: '2026-10-09T10:30:00Z', notes: [] }) });
    mount(api);
    await screen.findByTestId('echart');
    await choose('Across', 'Severity');
    await waitFor(() => expect(calls.filter((c) => c.name === 'aggregate').at(-1)?.body?.group_by).toEqual(['src_ip', 'severity']));
  });

  it('does not ask when both columns are the same, and says what to do', async () => {
    const { api, calls } = spy();
    mount(api);
    await screen.findByTestId('echart');
    const before = calls.filter((c) => c.name === 'aggregate').length;
    await choose('Across', 'Source IP');
    expect(await screen.findByText(/Choose two different columns/)).toBeInTheDocument();
    expect(calls.filter((c) => c.name === 'aggregate')).toHaveLength(before);
  });

  it('shows an empty state for a window with no events, and an error with a retry when the call fails', async () => {
    const empty = spy({ aggregate: () => ({ index_name: 'all_events', group_by: ['src_ip', 'outcome'], rows: [], total: 0, truncated: false, as_of: '2026-10-09T10:30:00Z', notes: [] }) });
    const { unmount } = mount(empty.api);
    expect(await screen.findByText(/No events in this window/)).toBeInTheDocument();
    unmount();
    const failing = spy({ aggregate: () => { throw new ApiError(500, 'boom', 'aggregate'); } });
    mount(failing.api);
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/boom|went wrong/i);
    expect(within(screen.getByTestId('error-state')).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

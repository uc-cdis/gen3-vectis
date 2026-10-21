import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SiemApi } from '@/lib/vectis-kit/api/client';
import { ApiError } from '@/lib/vectis-kit/api/client';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { RouteName } from '@/lib/vectis-kit/api';
import { getMockQuery } from '@/test/nextRouterMock';
import { renderSecurity } from '../testing/render';

const charts: Record<string, unknown>[] = [];
vi.mock('@gen3/frontend', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ReactECharts: (p: Record<string, unknown>) => { charts.push(p); return <div data-testid="echart" />; },
}));

import OverviewTab from '../tabs/OverviewTab';

/** The fixture API with chosen routes replaced. */
function apiWith(over: Partial<Record<RouteName, (input: unknown) => unknown>>): SiemApi {
  const base = createFixtureApi(0);
  return { mode: 'fixtures', call: async (name, input) => (over[name] ? (over[name]!(input) as never) : base.call(name, input)) };
}
const rejectWith = (status: number, route: RouteName) => () => { throw new ApiError(status, 'boom', route); };

describe('OverviewTab', () => {
  beforeEach(() => { charts.length = 0; });

  it('shows the needs-you strip with unmeasured values (never zero) and the explanation text', async () => {
    renderSecurity(<OverviewTab />);
    const strip = await screen.findByRole('region', { name: 'Needs you' });
    await within(strip).findByText('4');
    expect(within(strip).getAllByTestId('unmeasured')).toHaveLength(2);
    expect(within(strip).getByTestId('unmeasured-text')).toHaveTextContent('Pickup rate and trust floor are not measured yet.');
    expect(within(strip).queryByText('0%')).toBeNull();
  });

  it('counts events across every source, and draws the trend from all of them', async () => {
    const base = createFixtureApi(0);
    const seen: { name: string; body?: Record<string, unknown> }[] = [];
    const api = { mode: 'fixtures' as const, call: ((name: string, input: { body?: Record<string, unknown> }) => { seen.push({ name, body: input?.body }); return (base.call as (n: string, i: unknown) => unknown)(name, input); }) as typeof base.call };
    renderSecurity(<OverviewTab />, { api });
    const tiles = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(tiles).getByRole('button', { name: /^Events, all sources: 88,532/ })).toBeInTheDocument();
    await screen.findByTestId('rollup-chart');
    expect(seen.find((c) => c.name === 'timeline')?.body).toMatchObject({ index_name: 'all_events' });
  });

  it('renders telemetry as Unmeasured and real totals as numbers', async () => {
    renderSecurity(<OverviewTab />);
    const tiles = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(tiles).getByRole('button', { name: /^Web requests: 88,412/ })).toBeInTheDocument();
    const telemetry = within(tiles).getByRole('button', { name: /^Telemetry events: unmeasured/ });
    expect(within(telemetry).getByTestId('unmeasured')).toBeInTheDocument();
    expect(telemetry).not.toHaveTextContent('0');
  });

  it('names indicators loaded for what they are and counts alerts that matched one separately', async () => {
    renderSecurity(<OverviewTab />);
    const tiles = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(tiles).queryByRole('button', { name: /^Threat matches/ })).toBeNull();
    expect(within(tiles).getByRole('button', { name: /^Indicators loaded: 2,031/ })).toBeInTheDocument();
    const matched = within(tiles).getByRole('button', { name: /^Alerts matching indicators: 1\./ });
    expect(matched).toHaveTextContent('Alert groups in this window');
  });

  it('shows the audit total as Unmeasured when the source has no data, and says why accurately', async () => {
    const base = createFixtureApi(0);
    const api = apiWith({ overview: async () => {
      const o = await base.call('overview', { body: undefined as never });
      return { ...o, totals: { ...o.totals, audit: null, ioc_alerts: null } };
    } });
    renderSecurity(<OverviewTab />, { api });
    const tiles = await screen.findByRole('region', { name: 'Key figures' });
    const audit = within(tiles).getByRole('button', { name: /^Audit events: unmeasured/ });
    expect(within(audit).getByTestId('unmeasured')).toBeInTheDocument();
    expect(audit).not.toHaveTextContent('0');
    const matched = within(tiles).getByRole('button', { name: /^Alerts matching indicators: unmeasured/ });
    expect(within(matched).getByTestId('unmeasured')).toBeInTheDocument();
    // A measured zero stays a zero: only null is unmeasured.
    expect(within(tiles).getByRole('button', { name: /^Web requests: 88,412/ })).toBeInTheDocument();
  });

  it('a tile opens its tab', async () => {
    renderSecurity(<OverviewTab />);
    await userEvent.click(await screen.findByRole('button', { name: /^Indicators loaded/ }));
    await waitFor(() => expect(getMockQuery().tab).toBe('intel'));
  });

  it('draws the trend: events, distinct IPs on a second axis, bytes markers, zoom slider', async () => {
    renderSecurity(<OverviewTab />);
    await screen.findByTestId('rollup-chart');
    const trend = charts.find((c) => Array.isArray((c.option as { dataZoom?: unknown }).dataZoom))!;
    const opt = trend.option as { series: { name: string; type: string; yAxisIndex: number; data: unknown[] }[]; dataZoom: { type: string }[]; yAxis: unknown[] };
    expect(opt.series.map((s) => [s.type, s.yAxisIndex])).toEqual([['line', 0], ['line', 1], ['scatter', 2]]);
    expect(opt.series[0]!.data.length).toBe(288);
    expect(opt.dataZoom[0]!.type).toBe('slider');
    expect(opt.yAxis).toHaveLength(3);
  });

  it('shows an empty state, not a flat line, when the timeline has no points', async () => {
    const base = createFixtureApi(0);
    const api = apiWith({ timeline: async () => ({ ...(await base.call('timeline', {})), points: [] }) });
    renderSecurity(<OverviewTab />, { api });
    expect(await screen.findByText(/No events in this window/)).toBeInTheDocument();
    expect(screen.queryByTestId('rollup-chart')).toBeNull();
  });

  it('top lists: address values are entity links, others are plain text, bars have a table alternative', async () => {
    renderSecurity(<OverviewTab />);
    const ipPanel = (await screen.findByRole('heading', { name: 'Source IPs' })).closest('.mantine-Paper-root') as HTMLElement;
    const table = within(ipPanel).getByRole('table', { name: 'Source IPs, table' });
    await userEvent.click(within(table).getByRole('button', { name: '198.51.100.200' }));
    await waitFor(() => expect(getMockQuery().entity).toBe('ip:198.51.100.200'));
    const rules = screen.getByRole('table', { name: 'Rules, table' });
    expect(within(rules).getByText('secret-harvesting')).toBeInTheDocument();
    expect(within(rules).queryByRole('button')).toBeNull();
    const sources = screen.getByRole('table', { name: 'Event sources, table' });
    expect(within(sources).queryByRole('button')).toBeNull();
    expect(screen.getByRole('figure', { name: /Countries: US 40,100/ })).toBeInTheDocument();
    const bar = charts.find((c) => (c.option as { series?: { type: string }[] }).series?.[0]?.type === 'bar')!;
    expect(bar).toBeTruthy();
  });

  it('lists at most five alerts of severity high or above and opens one in the drawer', async () => {
    const seen: unknown[] = [];
    const base = createFixtureApi(0);
    const api = apiWith({ alerts: (i) => { seen.push(i); return base.call('alerts', i as never); } });
    renderSecurity(<OverviewTab />, { api });
    await screen.findByText('Most severe open alerts');
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect((seen[0] as { body: { min_severity: string } }).body.min_severity).toBe('high');
    const list = await screen.findByRole('heading', { name: 'Most severe open alerts' });
    const panel = list.closest('.mantine-Paper-root') as HTMLElement;
    const links = await within(panel).findAllByTitle(/^Open alert /);
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(5);
    await userEvent.click(links[0]!);
    await waitFor(() => expect(getMockQuery().alert).toBeTruthy());
  });

  it('summarises open cases', async () => {
    renderSecurity(<OverviewTab />);
    expect(await screen.findByTestId('cases-counts')).toHaveTextContent('2 open (1 in progress)');
  });

  it('shows an error state when the API rejects, and not a blank panel', async () => {
    const api = apiWith({ overview: rejectWith(500, 'overview'), triage: rejectWith(403, 'triage') });
    renderSecurity(<OverviewTab />, { api });
    await waitFor(() => expect(screen.getAllByTestId('error-state').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/You do not have access to this data/)).toBeInTheDocument();
    expect(screen.queryByText('Unmeasured')).toBeNull();
  });
});

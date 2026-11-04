import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { ApiError } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { FindSimilarResponse } from '@/lib/vectis-kit/spec';
import { getMockQuery } from '@/test/nextRouterMock';
import { renderSecurity } from '../testing/render';

const charts: { events?: Record<string, (e: unknown) => void>; option: Record<string, unknown> }[] = [];
vi.mock('@gen3/frontend', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ReactECharts: (p: { events?: Record<string, (e: unknown) => void>; option: Record<string, unknown> }) => { charts.push(p); return <div data-testid="echart" />; },
}));

import HuntTab from '../tabs/HuntTab';
import ExploreTab from '../tabs/ExploreTab';
import ViewsTab from '../tabs/ViewsTab';

type Call = { name: RouteName; input: { body?: Record<string, unknown>; params?: Record<string, string> } };
type Override = (input: Call['input']) => unknown;

/** Fixture API that records every call and can replace routes. */
function spyApi(over: Partial<Record<RouteName, Override>> = {}): { api: SiemApi; calls: Call[]; of: (n: RouteName) => Call[] } {
  const base = createFixtureApi(0);
  const calls: Call[] = [];
  const api: SiemApi = {
    mode: 'fixtures',
    call: async (name, input) => {
      calls.push({ name, input: (input ?? {}) as Call['input'] });
      const o = over[name];
      return o ? (o((input ?? {}) as Call['input']) as never) : base.call(name, input);
    },
  };
  return { api, calls, of: (n) => calls.filter((c) => c.name === n) };
}
/** The Explore tab on its Timeline view: the timeline, heat map and rows of a dragged range. */
const renderTimeline = async ({ url, ...opts }: NonNullable<Parameters<typeof renderSecurity>[1]> & { url: string }) => {
  renderSecurity(<ExploreTab />, { ...opts, url: `${url}${url.includes('?') ? '&' : '?'}explore=timeline` });
};

const reject = (status: number, message: string, route: RouteName): Override => () => { throw new ApiError(status, message, route); };
// The page has two charts (timeline and heat map); find the one that takes a brush.
const brushChart = () => [...charts].reverse().find((c) => typeof c.events?.brushEnd === 'function');
const brush = async (a: string, b: string) => {
  await waitFor(() => expect(brushChart()).toBeDefined());
  act(() => brushChart()!.events!.brushEnd!({ areas: [{ coordRange: [Date.parse(a), Date.parse(b)] }] }));
};

beforeEach(() => { charts.length = 0; });

describe('Hunt: timeline and linked rows', () => {
  it('starts on All events split by index, offers every hunting index, and requests the timeline for the chosen index and grain', async () => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: '/Security?tab=data' });
    const select = (await screen.findAllByLabelText('Index')).find((e) => e.tagName === 'INPUT')!;
    await waitFor(() => expect(of('timeline').at(-1)?.input.body).toMatchObject({ index_name: 'all_events', grain: '5m', group_by: ['index_name'] }));
    await userEvent.click(select);
    for (const n of ['all_events', 'http_activity', 'api_activity', 'network_activity']) expect(await screen.findByRole('option', { name: new RegExp(n), hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /authentication/, hidden: true })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: '1h' }));
    await waitFor(() => expect(of('timeline').at(-1)?.input.body).toMatchObject({ grain: '1h' }));
    expect(getMockQuery().hunt_grain).toBe('1h');
    // choosing one index drops the split
    await userEvent.click(await screen.findByRole('option', { name: /http_activity/, hidden: true }));
    await waitFor(() => expect(of('timeline').at(-1)?.input.body).toMatchObject({ index_name: 'http_activity' }));
    expect(of('timeline').at(-1)?.input.body).not.toHaveProperty('group_by');
  });

  it('draws the split as a stacked area, one band per index', async () => {
    const { api } = spyApi({ timeline: () => ({
      grain: '5m', source: 'raw', as_of: '2026-10-09T18:00:00Z', notes: [],
      points: [
        { bucket_start: '2026-10-09T10:00:00Z', event_count: 5, distinct_src_ips: 2, bytes_out_sum: null, bytes_out_max: null, dims: { index_name: 'http_activity' } },
        { bucket_start: '2026-10-09T10:00:00Z', event_count: 3, distinct_src_ips: 1, bytes_out_sum: null, bytes_out_max: null, dims: { index_name: 'authentication' } },
        { bucket_start: '2026-10-09T10:05:00Z', event_count: 7, distinct_src_ips: 2, bytes_out_sum: null, bytes_out_max: null, dims: { index_name: 'http_activity' } },
      ],
    }) });
    await renderTimeline({ api, url: '/Security?tab=data' });
    await waitFor(() => expect(charts.some((c) => Array.isArray(c.option.series) && (c.option.series as { stack?: string }[]).length === 2)).toBe(true));
    const series = charts.find((c) => Array.isArray(c.option.series) && (c.option.series as unknown[]).length === 2)!.option.series as { name: string; stack?: string; areaStyle?: unknown }[];
    expect(series.map((s) => s.name).sort()).toEqual(['authentication', 'http_activity']);
    for (const s of series) { expect(s.stack).toBe('events'); expect(s.areaStyle).toBeTruthy(); }
  });

  it('shows the activity heat map for the same window and filters', async () => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: '/Security?tab=data' });
    expect(await screen.findByTestId('activity-heatmap')).toBeInTheDocument();
    await waitFor(() => expect(of('aggregate').at(-1)?.input.body).toMatchObject({ index_name: 'all_events', group_by: ['src_ip', 'outcome'], top_n: 15 }));
    expect(of('timeline').at(-1)?.input.body?.window).toEqual(of('aggregate').at(-1)?.input.body?.window);
  });

  it('prompts for a range until one is brushed, and sends no rows request before that', async () => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: '/Security?tab=data' });
    expect(await screen.findByText(/No time range selected/)).toBeInTheDocument();
    expect(of('rows')).toHaveLength(0);
  });

  it('brushing a range loads rows for exactly that window, with the catalog default columns and limit 100', async () => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: '/Security?tab=data&hunt_index=http_activity' });
    await brush('2026-10-09T10:01:00Z', '2026-10-09T10:12:00Z');
    await waitFor(() => expect(of('rows')).toHaveLength(1));
    const body = of('rows')[0]!.input.body!;
    expect(body.window).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T10:15:00.000Z' });
    expect(body.index_name).toBe('http_activity');
    // the origin columns the index has (here: source) are always added after the first column
    expect(body.columns).toEqual(['event_time', 'source', 'src_ip', 'country', 'http_method', 'host_header', 'uri_path', 'status_code', 'rule_action', 'rule_id', 'sent_bytes']);
    expect(body.paging).toEqual({ limit: 100 });
    expect(getMockQuery()).toMatchObject({ hunt_from: '2026-10-09T10:00:00.000Z', hunt_to: '2026-10-09T10:15:00.000Z' });
    // the table, and address cells are entity links
    const link = await screen.findAllByRole('button', { name: '198.51.100.5' });
    await userEvent.click(link[0]!);
    await waitFor(() => expect(getMockQuery().entity).toBe('ip:198.51.100.5'));
  });

  it('is deep-linkable: index and range in the URL load the rows without any interaction', async () => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: '/Security?tab=data&hunt_index=api_activity&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    await waitFor(() => expect(of('rows')).toHaveLength(1));
    expect(of('rows')[0]!.input.body).toMatchObject({ index_name: 'api_activity', window: { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' }, columns: ['event_time', 'principal', 'api_service', 'api_operation', 'outcome', 'src_ip'] });
    expect(await screen.findByTestId('hunt-range')).toBeInTheDocument();
  });

  it('applies the filters carried in the link to the rows and the timeline, and shows them', async () => {
    const { api, of } = spyApi();
    const filters = JSON.stringify([{ field: 'src_ip', op: 'in', value: ['192.0.2.10', '198.51.100.7'] }]);
    await renderTimeline({ api, url: `/Security?tab=data&hunt_index=http_activity&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z&hunt_filters=${encodeURIComponent(filters)}` });
    await waitFor(() => expect(of('rows')).toHaveLength(1));
    const expected = [{ field: 'src_ip', op: 'in', value: ['192.0.2.10', '198.51.100.7'] }];
    expect(of('rows')[0]!.input.body).toMatchObject({ index_name: 'http_activity', filters: expected });
    await waitFor(() => expect(of('timeline').at(-1)?.input.body).toMatchObject({ filters: expected }));
    expect(await screen.findByTestId('hunt-filters')).toHaveTextContent('src_ip in 2 values');
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(getMockQuery().hunt_filters).toBeUndefined());
  });

  it.each([
    ['a malformed filter', [{ field: 'src_ip', op: 'regex', value: '.*' }]],
    ['a column the index does not have', [{ field: 'no_such_column', op: 'eq', value: 'x' }]],
  ])('never runs %s from the link', async (_name, bad) => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: `/Security?tab=data&hunt_index=http_activity&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z&hunt_filters=${encodeURIComponent(JSON.stringify(bad))}` });
    await waitFor(() => expect(of('rows')).toHaveLength(1));
    expect(of('rows')[0]!.input.body).not.toHaveProperty('filters');
    expect(screen.queryByTestId('hunt-filters')).toBeNull();
  });

  it('offers "List all in the table" when more rows exist than were loaded, carrying the index, range and filters', async () => {
    const base = createFixtureApi(0);
    const { api } = spyApi({ rows: (i) => base.call('rows', i as never).then((r) => ({ ...r, total: 5000, truncated: true })) });
    const filters = JSON.stringify([{ field: 'src_ip', op: 'in', value: ['192.0.2.10', '198.51.100.7'] }]);
    await renderTimeline({ api, url: `/Security?tab=data&hunt_index=http_activity&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z&hunt_filters=${encodeURIComponent(filters)}` });
    await userEvent.click(await screen.findByRole('button', { name: 'List all in the table' }));
    await waitFor(() => expect(getMockQuery()).toMatchObject({ tab: 'data', hunt_index: 'http_activity', hunt_from: '2026-10-09T10:00:00.000Z', hunt_to: '2026-10-09T11:00:00.000Z' }));
    expect(JSON.parse(String(getMockQuery().hunt_filters))).toEqual(JSON.parse(filters));
  });

  it('offers no "List all in the table" when every row was loaded', async () => {
    const base = createFixtureApi(0);
    const { api, of } = spyApi({ rows: (i) => base.call('rows', i as never).then((r) => ({ ...r, total: r.rows.length, truncated: false })) });
    await renderTimeline({ api, url: '/Security?tab=data&hunt_index=api_activity&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    await waitFor(() => expect(of('rows')).toHaveLength(1));
    await screen.findByText(/Showing \d+ of \d+ rows/);
    expect(screen.queryByRole('button', { name: 'List all in the table' })).toBeNull();
  });

  it('ignores a malformed range in the URL instead of sending it', async () => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: '/Security?tab=data&hunt_from=nope&hunt_to=2026-10-09T11:00:00Z&hunt_index=../etc' });
    expect(await screen.findByText(/No time range selected/)).toBeInTheDocument();
    expect(of('rows')).toHaveLength(0);
    // a non-hunting index name is ignored
    expect(of('timeline').at(-1)?.input.body).toMatchObject({ index_name: 'all_events' });
  });

  it('shows an empty state for a range with no rows', async () => {
    const { api } = spyApi({ rows: () => ({ as_of: '2026-10-09T18:00:00Z', columns: [], index_name: 'http_activity', rows: [], source_version: 1, total: 0, truncated: false }) });
    await renderTimeline({ api, url: '/Security?tab=data&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    expect(await screen.findByText(/No rows in this range/)).toBeInTheDocument();
  });

  it('shows an empty state, not a flat chart, when the timeline has no points', async () => {
    const base = createFixtureApi(0);
    const { api } = spyApi({ timeline: async (i) => ({ ...(await base.call('timeline', i as never)), points: [] }) });
    await renderTimeline({ api, url: '/Security?tab=data' });
    expect(await screen.findByText(/No rollup data in this window/)).toBeInTheDocument();
    expect(screen.queryByTestId('rollup-chart')).toBeNull();
  });
});

describe('Hunt: errors', () => {
  it('shows an error state when the catalog is rejected', async () => {
    const { api } = spyApi({ catalog: reject(403, 'denied', 'catalog') });
    await renderTimeline({ api, url: '/Security?tab=data' });
    expect(await screen.findByTestId('error-state')).toHaveTextContent('No access');
  });
  it('shows an error state for the timeline and for the rows independently', async () => {
    const { api } = spyApi({ timeline: reject(500, 'timeline broke', 'timeline'), rows: reject(500, 'rows broke', 'rows') });
    await renderTimeline({ api, url: '/Security?tab=data&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    await waitFor(() => expect(screen.getAllByTestId('error-state')).toHaveLength(2));
    expect(screen.getByText(/timeline broke/)).toBeInTheDocument();
    expect(screen.getByText(/rows broke/)).toBeInTheDocument();
  });
});

describe('Hunt: saved views', () => {
  it('does not list saved views or hunts: they are on the Views tab', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    await screen.findByTestId('hunt-page');
    expect(screen.queryByText('Saved views')).toBeNull();
    expect(screen.queryByText('Saved hunts')).toBeNull();
    expect(of('views')).toHaveLength(0);
  });
});

describe('Hunt: saved hunts', () => {
  it('saves a hunt from the Explore timeline with the current index and window', async () => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: '/Security?tab=data&hunt_index=http_activity&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    const form = await screen.findByRole('form', { name: 'Save the current view as a hunt' });
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), '  Slow scan from one ASN  ');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Hypothesis' }), 'Low and slow');
    await userEvent.click(within(form).getByRole('button', { name: 'Save as hunt' }));
    await waitFor(() => expect(of('huntCreate')).toHaveLength(1));
    expect(of('huntCreate')[0]!.input.body).toMatchObject({
      title: 'Slow scan from one ASN', hypothesis: 'Low and slow',
      spec: { index_name: 'http_activity', window: { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' }, grain: '5m' },
    });
    expect(screen.queryByText('Oversized responses')).toBeNull();      // the list is on the Views tab
  });

  it('refuses an empty title without calling the API', async () => {
    const { api, of } = spyApi();
    await renderTimeline({ api, url: '/Security?tab=data' });
    const form = await screen.findByRole('form', { name: 'Save the current view as a hunt' });
    await userEvent.click(within(form).getByRole('button', { name: 'Save as hunt' }));
    expect(await within(form).findByText('Give the hunt a title.')).toBeInTheDocument();
    expect(of('huntCreate')).toHaveLength(0);
  });

  it('lists saved hunts on the Views tab, without a save form', async () => {
    const { api } = spyApi();
    renderSecurity(<ViewsTab />, { api, url: '/Investigate?tab=views' });
    expect(await screen.findAllByLabelText(/Verdict for Oversized responses/)).not.toHaveLength(0);
    expect(screen.queryByRole('form', { name: 'Save the current view as a hunt' })).toBeNull();
  });

  it('patches the verdict with the etag it loaded', async () => {
    const { api, of } = spyApi();
    renderSecurity(<ViewsTab />, { api, url: '/Investigate?tab=views' });
    const verdict = (await screen.findAllByLabelText(/Verdict for Oversized responses/)).find((e) => e.tagName === 'INPUT')!;
    await userEvent.click(verdict);
    await userEvent.click(await screen.findByRole('option', { name: 'Proven', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: /Save changes to Oversized/ }));
    await waitFor(() => expect(of('huntPatch')).toHaveLength(1));
    expect(of('huntPatch')[0]!.input).toMatchObject({ params: { id: 'hunt-0001' }, body: { expected_etag: 'h-1', verdict: 'proven' } });
  });

  it('shows the conflict message on a 412 and keeps the analyst\'s draft until they reload', async () => {
    const { api } = spyApi({ huntPatch: reject(412, 'This hunt changed since you opened it. Reload and try again.', 'huntPatch') });
    renderSecurity(<ViewsTab />, { api, url: '/Investigate?tab=views' });
    const box = await screen.findByRole('textbox', { name: /Hypothesis for Oversized/ });
    await userEvent.type(box, ' Edited.');
    await userEvent.click(screen.getByRole('button', { name: /Save changes to Oversized/ }));
    const alert = await screen.findByTestId('error-state');
    expect(alert).toHaveTextContent('Changed by someone else');
    expect(alert).toHaveTextContent('This hunt changed since you opened it. Reload and try again.');
    expect(box).toHaveValue('Actors that probe /.env then pull large objects are collecting data. Edited.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByTestId('error-state')).toBeNull());
    expect(screen.getByRole('textbox', { name: /Hypothesis for Oversized/ })).toHaveValue('Actors that probe /.env then pull large objects are collecting data.');
  });
});

describe('Hunt: find similar', () => {
  const seed = { type: 'ip', value: '203.0.113.50' };
  const SIMILAR_IP = '/Security?tab=hunt&similar=ip:203.0.113.50';

  it('shows four labelled sets and Unmeasured (not an empty list) for behavioral', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: SIMILAR_IP });
    await waitFor(() => expect(of('findSimilar')).toHaveLength(1));
    expect(of('findSimilar')[0]!.input.body).toEqual({ seed });

    const behavioral = await screen.findByTestId('similar-behavioral');
    expect(within(behavioral).getByTestId('unmeasured')).toBeInTheDocument();
    expect(within(behavioral).queryByText('No matches.')).toBeNull();
    for (const name of ['Exact', 'Structural', 'Behavioral', 'Graph']) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    expect(within(screen.getByTestId('similar-exact')).queryByTestId('unmeasured')).toBeNull();
    expect(within(screen.getByTestId('similar-graph')).queryByTestId('unmeasured')).toBeNull();
  });

  it('is not a second search form: the one box at the top starts every search', async () => {
    const { api } = spyApi();
    renderSecurity(<HuntTab />, { api, url: SIMILAR_IP });
    await screen.findByTestId('similar-exact');
    expect(screen.queryByRole('form', { name: 'Find similar' })).toBeNull();
    expect(screen.getAllByRole('form')).toHaveLength(1);
  });

  it('results link onward: exact opens the alert, addresses open the entity', async () => {
    const { api } = spyApi();
    renderSecurity(<HuntTab />, { api, url: SIMILAR_IP });
    const exact = await screen.findByTestId('similar-exact');
    await userEvent.click(within(exact).getByTitle('Open alert g-ioc-match'));
    await waitFor(() => expect(getMockQuery().alert).toBe('g-ioc-match'));
    const structural = screen.getByTestId('similar-structural');
    await userEvent.click(within(structural).getAllByRole('button', { name: '203.0.113.50' })[0]!);
    await waitFor(() => expect(getMockQuery().entity).toBe('ip:203.0.113.50'));
    const graph = screen.getByTestId('similar-graph');
    await userEvent.click(within(graph).getByRole('button', { name: '198.51.100.10' }));
    await waitFor(() => expect(getMockQuery().entity).toBe('ip:198.51.100.10'));
  });

  it('consumes ?similar= from the context: an alert id runs the search once', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&similar=g-ioc-match' });
    await screen.findByTestId('similar-behavioral');
    expect(of('findSimilar')).toHaveLength(1);
    expect(of('findSimilar')[0]!.input.body).toEqual({ group_id: 'g-ioc-match' });
  });

  it('the box takes an alert id too, and rejects one that is not a valid identifier', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Start an investigation' });
    await userEvent.click(within(form).getAllByLabelText('Follow').find((e) => e.tagName === 'INPUT')!);
    await userEvent.click(await screen.findByRole('option', { name: 'Alert id', hidden: true }));
    const box = within(form).getByRole('textbox', { name: 'Entity value' });
    await userEvent.type(box, '../x g-1');
    await userEvent.click(within(form).getByRole('button', { name: 'Investigate' }));
    expect(await within(form).findByText(/starts with a letter or digit/)).toBeInTheDocument();
    expect(of('findSimilar')).toHaveLength(0);
    await userEvent.clear(box);
    await userEvent.type(box, 'g-ioc-match');
    await userEvent.click(within(form).getByRole('button', { name: 'Investigate' }));
    await waitFor(() => expect(getMockQuery().similar).toBe('g-ioc-match'));
  });

  it('shows a measured set with nothing in it as "No matches", distinct from Unmeasured', async () => {
    const empty: FindSimilarResponse = { exact: [], structural: [], behavioral: [], graph: null, measured: { exact: true, structural: false, behavioral: true, graph: false } };
    const { api } = spyApi({ findSimilar: () => empty });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&similar=ip:192.0.2.1' });
    expect(await within(await screen.findByTestId('similar-exact')).findByText('No matches.')).toBeInTheDocument();
    expect(within(screen.getByTestId('similar-behavioral')).getByText('No matches.')).toBeInTheDocument();
    expect(within(screen.getByTestId('similar-structural')).getByTestId('unmeasured')).toBeInTheDocument();
    expect(within(screen.getByTestId('similar-graph')).getByTestId('unmeasured')).toBeInTheDocument();
  });

  it('shows an error state when findSimilar is rejected', async () => {
    const { api } = spyApi({ findSimilar: reject(500, 'search failed', 'findSimilar') });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&similar=ip:192.0.2.1' });
    expect(await screen.findByText(/search failed/)).toBeInTheDocument();
  });
});

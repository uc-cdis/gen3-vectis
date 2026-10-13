import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { ApiError } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { FindSimilarResponse, SavedViewList } from '@/lib/vectis-kit/spec';
import { getMockQuery } from '@/test/nextRouterMock';
import { renderSecurity } from '../testing/render';

const charts: { events?: Record<string, (e: unknown) => void>; option: Record<string, unknown> }[] = [];
vi.mock('@gen3/frontend', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ReactECharts: (p: { events?: Record<string, (e: unknown) => void>; option: Record<string, unknown> }) => { charts.push(p); return <div data-testid="echart" />; },
}));

import HuntTab from '../tabs/HuntTab';

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
const reject = (status: number, message: string, route: RouteName): Override => () => { throw new ApiError(status, message, route); };
const brush = async (a: string, b: string) => {
  await waitFor(() => expect(charts.at(-1)?.events?.brushEnd).toBeTypeOf('function'));
  act(() => charts.at(-1)!.events!.brushEnd!({ areas: [{ coordRange: [Date.parse(a), Date.parse(b)] }] }));
};

beforeEach(() => { charts.length = 0; });

describe('Hunt: timeline and linked rows', () => {
  it('offers the three hunting indexes from the catalog and requests the timeline for the chosen index and grain', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const select = (await screen.findAllByLabelText('Index')).find((e) => e.tagName === 'INPUT')!;
    await userEvent.click(select);
    for (const n of ['http_activity', 'api_activity', 'network_activity']) expect(await screen.findByRole('option', { name: new RegExp(n), hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /authentication/, hidden: true })).toBeNull();
    await waitFor(() => expect(of('timeline').at(-1)?.input.body).toMatchObject({ index_name: 'http_activity', grain: '5m' }));
    await userEvent.click(screen.getByRole('radio', { name: '1h' }));
    await waitFor(() => expect(of('timeline').at(-1)?.input.body).toMatchObject({ grain: '1h' }));
    expect(getMockQuery().hunt_grain).toBe('1h');
  });

  it('prompts for a range until one is brushed, and sends no rows request before that', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    expect(await screen.findByText(/No time range selected/)).toBeInTheDocument();
    expect(of('rows')).toHaveLength(0);
  });

  it('brushing a range loads rows for exactly that window, with the catalog default columns and limit 100', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    await brush('2026-10-09T10:01:00Z', '2026-10-09T10:12:00Z');
    await waitFor(() => expect(of('rows')).toHaveLength(1));
    const body = of('rows')[0]!.input.body!;
    expect(body.window).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T10:15:00.000Z' });
    expect(body.index_name).toBe('http_activity');
    expect(body.columns).toEqual(['event_time', 'src_ip', 'country', 'http_method', 'host_header', 'uri_path', 'status_code', 'rule_action', 'rule_id', 'sent_bytes']);
    expect(body.paging).toEqual({ limit: 100 });
    expect(getMockQuery()).toMatchObject({ hunt_from: '2026-10-09T10:00:00.000Z', hunt_to: '2026-10-09T10:15:00.000Z' });
    // the table, and address cells are entity links
    const link = await screen.findAllByRole('button', { name: '198.51.100.5' });
    await userEvent.click(link[0]!);
    await waitFor(() => expect(getMockQuery().entity).toBe('ip:198.51.100.5'));
  });

  it('is deep-linkable: index and range in the URL load the rows without any interaction', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&hunt_index=api_activity&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    await waitFor(() => expect(of('rows')).toHaveLength(1));
    expect(of('rows')[0]!.input.body).toMatchObject({ index_name: 'api_activity', window: { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' }, columns: ['event_time', 'principal', 'api_service', 'api_operation', 'outcome', 'src_ip'] });
    expect(await screen.findByTestId('hunt-range')).toBeInTheDocument();
  });

  it('ignores a malformed range in the URL instead of sending it', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&hunt_from=nope&hunt_to=2026-10-09T11:00:00Z&hunt_index=../etc' });
    expect(await screen.findByText(/No time range selected/)).toBeInTheDocument();
    expect(of('rows')).toHaveLength(0);
    expect(of('timeline').at(-1)?.input.body).toMatchObject({ index_name: 'http_activity' });
  });

  it('shows an empty state for a range with no rows', async () => {
    const { api } = spyApi({ rows: () => ({ as_of: '2026-10-09T18:00:00Z', columns: [], index_name: 'http_activity', rows: [], source_version: 1, total: 0, truncated: false }) });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    expect(await screen.findByText(/No rows in this range/)).toBeInTheDocument();
  });

  it('shows an empty state, not a flat chart, when the timeline has no points', async () => {
    const base = createFixtureApi(0);
    const { api } = spyApi({ timeline: async (i) => ({ ...(await base.call('timeline', i as never)), points: [] }) });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    expect(await screen.findByText(/No rollup data in this window/)).toBeInTheDocument();
    expect(screen.queryByTestId('rollup-chart')).toBeNull();
  });
});

describe('Hunt: errors', () => {
  it('shows an error state when the catalog is rejected', async () => {
    const { api } = spyApi({ catalog: reject(403, 'denied', 'catalog') });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    expect(await screen.findByTestId('error-state')).toHaveTextContent('No access');
  });
  it('shows an error state for the timeline and for the rows independently', async () => {
    const { api } = spyApi({ timeline: reject(500, 'timeline broke', 'timeline'), rows: reject(500, 'rows broke', 'rows') });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    await waitFor(() => expect(screen.getAllByTestId('error-state')).toHaveLength(2));
    expect(screen.getByText(/timeline broke/)).toBeInTheDocument();
    expect(screen.getByText(/rows broke/)).toBeInTheDocument();
  });
});

describe('Hunt: saved views', () => {
  const views: SavedViewList = {
    views: [{
      id: 'v-api', title: 'API sweep', kind: 'hunt', scope: 'shared', owner: null, is_default: false, layout: {},
      spec: { index_name: 'api_activity', window: { start: '2026-10-09T08:00:00Z', end: '2026-10-09T09:00:00Z' }, columns: ['principal', 'outcome', 'bogus_column'], filters: [{ field: 'outcome', op: 'eq', value: 'DENIED' }], grain: '1h' },
    }],
  };

  it('applying a view sets the index, columns and range from its spec', async () => {
    const { api, of } = spyApi({ views: () => views });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    await userEvent.click(await screen.findByRole('button', { name: 'Apply view API sweep' }));
    await waitFor(() => expect(of('rows')).toHaveLength(1));
    const body = of('rows')[0]!.input.body!;
    expect(body).toMatchObject({
      index_name: 'api_activity',
      columns: ['principal', 'outcome'], // the column the catalog does not know is dropped
      window: { start: '2026-10-09T08:00:00.000Z', end: '2026-10-09T09:00:00.000Z' },
      filters: [{ field: 'outcome', op: 'eq', value: 'DENIED' }],
    });
    expect(getMockQuery()).toMatchObject({ hunt_index: 'api_activity', hunt_grain: '1h' });
    expect(of('timeline').at(-1)!.input.body).toMatchObject({ index_name: 'api_activity', grain: '1h', window: { start: '2026-10-09T08:00:00.000Z' } });
    // the fixture API honours the applied filter, and no fixture row has outcome=DENIED
    expect(await screen.findByText(/No rows in this range/)).toBeInTheDocument();
  });

  it('lists the fixture views', async () => {
    const { api } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    expect(await screen.findByRole('button', { name: 'Apply view Active attackers' })).toBeInTheDocument();
  });
});

describe('Hunt: saved hunts', () => {
  it('creates a hunt from the current view and lists it', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&hunt_from=2026-10-09T10:00:00Z&hunt_to=2026-10-09T11:00:00Z' });
    const form = await screen.findByRole('form', { name: 'Save the current view as a hunt' });
    await userEvent.type(within(form).getByRole('textbox', { name: /Title/ }), '  Slow scan from one ASN  ');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Hypothesis' }), 'Low and slow');
    await userEvent.click(within(form).getByRole('button', { name: 'Save as hunt' }));
    await waitFor(() => expect(of('huntCreate')).toHaveLength(1));
    expect(of('huntCreate')[0]!.input.body).toMatchObject({
      title: 'Slow scan from one ASN', hypothesis: 'Low and slow',
      spec: { index_name: 'http_activity', window: { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' }, grain: '5m' },
    });
    expect(await screen.findByRole('listitem', { name: 'Hunt Slow scan from one ASN' })).toBeInTheDocument();
  });

  it('refuses an empty title without calling the API', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Save the current view as a hunt' });
    await userEvent.click(within(form).getByRole('button', { name: 'Save as hunt' }));
    expect(await within(form).findByText('Give the hunt a title.')).toBeInTheDocument();
    expect(of('huntCreate')).toHaveLength(0);
  });

  it('patches the verdict with the etag it loaded', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const verdict = (await screen.findAllByLabelText(/Verdict for Oversized responses/)).find((e) => e.tagName === 'INPUT')!;
    await userEvent.click(verdict);
    await userEvent.click(await screen.findByRole('option', { name: 'Proven', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: /Save changes to Oversized/ }));
    await waitFor(() => expect(of('huntPatch')).toHaveLength(1));
    expect(of('huntPatch')[0]!.input).toMatchObject({ params: { id: 'hunt-0001' }, body: { expected_etag: 'h-1', verdict: 'proven' } });
  });

  it('shows the conflict message on a 412 and keeps the analyst\'s draft until they reload', async () => {
    const { api } = spyApi({ huntPatch: reject(412, 'This hunt changed since you opened it. Reload and try again.', 'huntPatch') });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
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

  it('shows four labelled sets and Unmeasured (not an empty list) for behavioral', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Find similar' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Value' }), seed.value);
    await userEvent.click(within(form).getByRole('button', { name: 'Find similar' }));
    await waitFor(() => expect(of('findSimilar')).toHaveLength(1));
    expect(of('findSimilar')[0]!.input.body).toEqual({ seed });

    const behavioral = await screen.findByTestId('similar-behavioral');
    expect(within(behavioral).getByTestId('unmeasured')).toBeInTheDocument();
    expect(within(behavioral).queryByText('No matches.')).toBeNull();
    for (const name of ['Exact', 'Structural', 'Behavioral', 'Graph']) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    expect(within(screen.getByTestId('similar-exact')).queryByTestId('unmeasured')).toBeNull();
    expect(within(screen.getByTestId('similar-graph')).queryByTestId('unmeasured')).toBeNull();
  });

  it('results link onward: exact opens the alert, addresses open the entity', async () => {
    const { api } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Find similar' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Value' }), seed.value);
    await userEvent.click(within(form).getByRole('button', { name: 'Find similar' }));
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

  it('consumes ?similar= from the context: an alert id prefills the panel and runs the search once', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&similar=g-ioc-match' });
    await screen.findByTestId('similar-behavioral');
    expect(of('findSimilar')).toHaveLength(1);
    expect(of('findSimilar')[0]!.input.body).toEqual({ group_id: 'g-ioc-match' });
    expect(screen.getByRole('textbox', { name: 'Alert id' })).toHaveValue('g-ioc-match');
  });

  it('consumes ?similar= for an entity seed', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt&similar=ip:203.0.113.50' });
    await screen.findByTestId('similar-exact');
    expect(of('findSimilar')[0]!.input.body).toEqual({ seed });
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('203.0.113.50');
  });

  it('can search by alert id, and rejects an id that is not a valid identifier', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Find similar' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Alert id' }));
    await userEvent.type(within(form).getByRole('textbox', { name: 'Alert id' }), '../x g-1');
    await userEvent.click(within(form).getByRole('button', { name: 'Find similar' }));
    expect(await within(form).findByText(/starts with a letter or digit/)).toBeInTheDocument();
    expect(of('findSimilar')).toHaveLength(0);
    await userEvent.clear(within(form).getByRole('textbox', { name: 'Alert id' }));
    await userEvent.type(within(form).getByRole('textbox', { name: 'Alert id' }), 'g-ioc-match');
    await userEvent.click(within(form).getByRole('button', { name: 'Find similar' }));
    await waitFor(() => expect(of('findSimilar')).toHaveLength(1));
    expect(of('findSimilar')[0]!.input.body).toEqual({ group_id: 'g-ioc-match' });
  });

  it('shows a measured set with nothing in it as "No matches", distinct from Unmeasured', async () => {
    const empty: FindSimilarResponse = { exact: [], structural: [], behavioral: [], graph: null, measured: { exact: true, structural: false, behavioral: true, graph: false } };
    const { api } = spyApi({ findSimilar: () => empty });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Find similar' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Value' }), '192.0.2.1');
    await userEvent.click(within(form).getByRole('button', { name: 'Find similar' }));
    expect(await within(await screen.findByTestId('similar-exact')).findByText('No matches.')).toBeInTheDocument();
    expect(within(screen.getByTestId('similar-behavioral')).getByText('No matches.')).toBeInTheDocument();
    expect(within(screen.getByTestId('similar-structural')).getByTestId('unmeasured')).toBeInTheDocument();
    expect(within(screen.getByTestId('similar-graph')).getByTestId('unmeasured')).toBeInTheDocument();
  });

  it('shows an error state when findSimilar is rejected', async () => {
    const { api } = spyApi({ findSimilar: reject(500, 'search failed', 'findSimilar') });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Find similar' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Value' }), '192.0.2.1');
    await userEvent.click(within(form).getByRole('button', { name: 'Find similar' }));
    expect(await screen.findByText(/search failed/)).toBeInTheDocument();
  });
});

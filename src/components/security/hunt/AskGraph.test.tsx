import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { getMockQuery } from '@/test/nextRouterMock';
import userEvent from '@testing-library/user-event';
import type { RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import { renderSecurity } from '../testing/render';

vi.mock('@gen3/frontend', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ReactECharts: () => <div data-testid="echart" />,
}));

import HuntTab from '../tabs/HuntTab';

const LINK = '/Security?tab=hunt&inv_type=ip&inv_value=203.0.113.50&inv_at=2026-10-22T14:30:00.000Z&inv_span=5&inv_scope=actor';

function spyApi(over: Partial<Record<RouteName, () => unknown>> = {}): { api: SiemApi; of: (n: RouteName) => { body?: Record<string, unknown> }[] } {
  const base = createFixtureApi(0);
  const calls: { name: RouteName; input: { body?: Record<string, unknown> } }[] = [];
  const api: SiemApi = { mode: 'fixtures', call: async (name, input) => { calls.push({ name, input: (input ?? {}) as never }); return over[name] ? (over[name]!() as never) : base.call(name, input); } };
  return { api, of: (n) => calls.filter((c) => c.name === n).map((c) => c.input) };
}

beforeEach(() => { vi.clearAllMocks(); });

/** Ask the graph sits in a tab beside the events: open it, then find its panel. */
const openAsk = async () => {
  await userEvent.click(await screen.findByRole('tab', { name: 'Ask the graph' }));
  return screen.findByRole('region', { name: 'Ask the graph' });
};

describe('Hunt: ask the graph', () => {
  it('offers only the questions that start from this kind of entity and asks from the id the profile reports', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.click(await within(panel).findByLabelText('Question'));
    expect(await screen.findByRole('option', { name: /H1: address -> JA4/, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /S1b: address -> its user agents/, hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /S1a: fingerprint/, hidden: true })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: /H1: address -> JA4/, hidden: true }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(of('graphAsk')).toHaveLength(1));
    expect(of('graphAsk')[0].body).toEqual({ path_id: 'H1', start_id: 'tenant1:IpAddress:203.0.113.50' });
  });

  it('shows each step with how many of how many it lists, and what the walk reached', async () => {
    const { api } = spyApi();
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.click(await within(panel).findByLabelText('Question'));
    await userEvent.click(await screen.findByRole('option', { name: /H1: address -> JA4/, hidden: true }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Ask' }));
    const first = await screen.findByTestId('ask-step-0');
    expect(within(first).getByText('1. used fingerprint')).toBeInTheDocument();
    expect(within(first).getByText('2 of 2')).toBeInTheDocument();
    expect(within(first).getByText(/t13d591000_a33745022dd6_1f22a2ca17c4/)).toBeInTheDocument();
    expect(within(first).getByText('41 events')).toBeInTheDocument();
    const second = screen.getByTestId('ask-step-1');
    expect(within(second).getByText('2. seen by')).toBeInTheDocument();
    expect(within(second).getByText('1 of 1')).toBeInTheDocument();
  });

  it('a question typed in words is matched by the service and run when chosen', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.type(await within(panel).findByLabelText('Or ask in your own words'), 'which fingerprints did it use');
    await userEvent.click(within(panel).getByRole('button', { name: 'Find the question' }));
    await waitFor(() => expect(of('graphMatch')).toHaveLength(1));
    expect(of('graphMatch')[0].body).toEqual({ text: 'which fingerprints did it use', start: 'IpAddress' });
    await userEvent.click(await within(panel).findByRole('button', { name: /H1: address -> JA4/ }));
    await waitFor(() => expect(of('graphAsk')[0].body).toEqual({ path_id: 'H1', start_id: 'tenant1:IpAddress:203.0.113.50' }));
  });

  it('says so when no question shares a word with what was typed', async () => {
    const { api } = spyApi({ graphMatch: () => ({ matches: [] }) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.type(await within(panel).findByLabelText('Or ask in your own words'), 'weather');
    await userEvent.click(within(panel).getByRole('button', { name: 'Find the question' }));
    expect(await within(panel).findByText(/No question shares a word/)).toBeInTheDocument();
  });

  it('a question that starts in the events is not offered, because the graph cannot walk it', async () => {
    const paths = { paths: [{ id: 'X1', scenario: 'S3', title: 'address -> its egress', start: 'IpAddress', steps: 1, in_graph: false }, { id: 'H1', scenario: 'H', title: 'address -> JA4', start: 'IpAddress', steps: 1, in_graph: true }] };
    const { api } = spyApi({ graphPaths: () => paths });
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.click(await within(panel).findByLabelText('Question'));
    expect(await screen.findByRole('option', { name: /H1: address -> JA4/, hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /X1/, hidden: true })).toBeNull();
  });

  it('any entity a step reaches can be asked from, and the way back leads to the entity investigated', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.click(await within(panel).findByLabelText('Question'));
    await userEvent.click(await screen.findByRole('option', { name: /H1: address -> JA4/, hidden: true }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Ask' }));
    await userEvent.click(await within(panel).findByRole('button', { name: 'Ask from t13d591000_a33745022dd6_1f22a2ca17c4' }));
    expect(await within(panel).findByText(/Asking from t13d591000/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Back to 203.0.113.50' }));
    expect(within(panel).queryByText(/Asking from/)).toBeNull();
    expect(of('graphAsk')).toHaveLength(1);
  });

  it('the rarest order is asked for when the switch is on, and each entity says how many reach it', async () => {
    const answer = { path_id: 'H1', title: 't', start_id: 'tenant1:IpAddress:203.0.113.50', continues_in_events: false, steps: [{ index: 0, relation: 'requested', from_label: 'IpAddress', to_label: 'Domain', total: 1, truncated: false, edges: [], reached: [{ id: 'tenant1:Domain:rare.example.test', label: 'Domain', name: null, count: 2, reach: 1 }] }] };
    const { api, of } = spyApi({ graphAsk: () => answer });
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.click(await within(panel).findByLabelText('Question'));
    await userEvent.click(await screen.findByRole('option', { name: /H1: address -> JA4/, hidden: true }));
    await userEvent.click(within(panel).getByRole('switch', { name: /Rarest first/ }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(of('graphAsk')[0].body).toEqual({ path_id: 'H1', start_id: 'tenant1:IpAddress:203.0.113.50', order: 'rarest' }));
    expect(await within(panel).findByText('reached by 1')).toBeInTheDocument();
  });

  it('a question that goes on in the events offers to list them in Data, filtered to the walked entities', async () => {
    const answer = { path_id: 'H1', title: 't', start_id: 'tenant1:IpAddress:203.0.113.50', continues_in_events: true, steps: [{ index: 1, relation: 'from_ip', from_label: 'IpAddress', to_label: 'WafRequest', total: 0, truncated: false, edges: [], reached: [], events: { index_name: 'http_activity', field: 'src_ip', values: ['203.0.113.50'] } }] };
    const { api } = spyApi({ graphAsk: () => answer });
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.click(await within(panel).findByLabelText('Question'));
    await userEvent.click(await screen.findByRole('option', { name: /H1: address -> JA4/, hidden: true }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Ask' }));
    await userEvent.click(await within(panel).findByRole('button', { name: 'List these events in Explore' }));
    await waitFor(() => expect(getMockQuery()).toMatchObject({ tab: 'data', hunt_index: 'http_activity' }));
    expect(JSON.parse(String(getMockQuery().hunt_filters))).toEqual([{ field: 'src_ip', op: 'eq', value: '203.0.113.50' }]);
  });

  it('events of a kind Data does not list are shown but cannot be opened there', async () => {
    const answer = { path_id: 'H1', title: 't', start_id: 'tenant1:IpAddress:203.0.113.50', continues_in_events: true, steps: [{ index: 1, relation: 'ran', from_label: 'Host', to_label: 'Process', total: 0, truncated: false, edges: [], reached: [], events: { index_name: 'process_activity', field: 'hostname', values: ['a', 'b'] } }] };
    const { api } = spyApi({ graphAsk: () => answer });
    renderSecurity(<HuntTab />, { api, url: LINK });
    const panel = await openAsk();
    await userEvent.click(await within(panel).findByLabelText('Question'));
    await userEvent.click(await screen.findByRole('option', { name: /H1: address -> JA4/, hidden: true }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Ask' }));
    expect(await within(panel).findByText(/one of 2 entities/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'List these events in Explore' })).toBeDisabled();
  });
});

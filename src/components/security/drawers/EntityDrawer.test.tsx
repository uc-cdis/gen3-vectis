import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityProfileResponse, GraphTraverseResponse } from '@/lib/vectis-kit/spec';
import { FIXTURES } from '@/lib/vectis-kit/api/fixtureApi';
import { edgeKey } from '@/lib/vectis-kit/entity-graph/graphModel';
import { getMockQuery } from '@/test/nextRouterMock';

vi.mock('@gen3/frontend', async (orig) => {
  const { mockCharts } = await import('../entities/testUtils');
  return { ...(await orig<Record<string, unknown>>()), ...mockCharts() };
});
import { chartCalls, lastGraphChart, rejecting, testApi } from '../entities/testUtils';
import { renderSecurity } from '../testing/render';
import EntityDrawer from './EntityDrawer';

const seed = { type: 'ip', value: '203.0.113.50' } as const;
const profile = FIXTURES['entity.profile'] as unknown as EntityProfileResponse;
const graph = FIXTURES['graph.response'] as unknown as GraphTraverseResponse;
const mount = (api = testApi(), url = '/Security?tab=entities') => renderSecurity(<EntityDrawer seed={seed} onClose={() => undefined} />, { api, url });

describe('EntityDrawer', () => {
  beforeEach(() => { chartCalls.props.length = 0; });

  it('shows identity, facts, alert groups, cases and the graph from the profile', async () => {
    const api = testApi();
    mount(api);
    expect(screen.getByText('ip: 203.0.113.50')).toBeInTheDocument(); // title
    expect(await screen.findByText('Example Hosting', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('1,244')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open alert Recon followed/ })).toBeInTheDocument();
    expect(screen.getByText('Web application intrusion (sample)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy entity key' })).toBeInTheDocument();
    // source mix has a chart and the same numbers as text
    expect(screen.getByRole('list', { name: 'Events per source' })).toHaveTextContent('waf: 702');
    // the graph is started from the tenant-qualified node id
    await waitFor(() => expect(api.calls.find((c) => c.name === 'graph')?.body).toEqual({ start_id: 'tenant1:IpAddress:203.0.113.50', max_hops: 2, limit: 200 }));
  });

  it('renders unmeasured geo as Unmeasured, not as blank or zero', async () => {
    const api = testApi({ entityProfile: () => ({ ...profile, geo: null, first_seen: null, event_count: null }) });
    mount(api);
    await screen.findByText('Source mix');
    expect(screen.getAllByTestId('unmeasured').length).toBeGreaterThanOrEqual(5); // country, city, asn, first seen, events
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows the error state when the API rejects, and no data', async () => {
    mount(testApi({ entityProfile: rejecting(500, 'boom', 'entityProfile') }));
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/boom/);
    expect(screen.queryByText('Source mix')).toBeNull();
  });

  it('shows 403 as no access', async () => {
    mount(testApi({ entityProfile: rejecting(403, 'nope', 'entityProfile') }));
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/No access/);
  });

  it('opens an alert from an alert group row', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Open alert Recon followed/ }));
    await waitFor(() => expect(getMockQuery().alert).toBe('g-progression-a'));
  });

  it('Find similar goes to the Hunt tab seeded with the entity', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Find similar' }));
    await waitFor(() => expect(getMockQuery()).toMatchObject({ tab: 'hunt', similar: 'ip:203.0.113.50' }));
  });

  it('adds the entity to the watchlist, validated, and shows the outcome and bundle key', async () => {
    const api = testApi();
    mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to watchlist' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByTestId('watchlist-result')).toHaveTextContent('raw/stix/watchlist-example.json');
    expect(api.calls.find((c) => c.name === 'watchlist')?.body).toEqual({ entries: [{ type: 'ip', value: '203.0.113.50', confidence: 75, expires_at: null, note: '' }] });
  });

  it('refuses an out-of-range confidence without calling the API', async () => {
    const api = testApi();
    mount(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to watchlist' }));
    const input = screen.getByLabelText(/Confidence/);
    await userEvent.clear(input);
    await userEvent.type(input, '999');
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/0 to 100/);
    expect(api.calls.some((c) => c.name === 'watchlist')).toBe(false);
  });

  it('shows the API rejection of a watchlist add', async () => {
    mount(testApi({ watchlist: rejecting(500, 'store down', 'watchlist') }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to watchlist' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await within(await screen.findByRole('form', { name: 'Add to watchlist' })).findByTestId('error-state')).toHaveTextContent(/store down/);
  });

  it('disables Add to watchlist for entities that are not indicators', async () => {
    const api = testApi();
    renderSecurity(<EntityDrawer seed={{ type: 'user', value: 'alice' }} onClose={() => undefined} />, { api });
    expect(await screen.findByRole('button', { name: 'Add to watchlist' })).toBeDisabled();
  });

  describe('graph', () => {
    it('clicking an edge shows its relation and endpoints', async () => {
      mount();
      await screen.findByTestId('entity-graph');
      const chart = await waitFor(() => { const c = lastGraphChart(); if (!c) throw new Error('no chart'); return c; });
      const e = graph.edges[0]!;
      chart.events!.click!({ dataType: 'edge', data: { id: edgeKey(e) } });
      const panel = await screen.findByTestId('graph-selection');
      expect(panel).toHaveTextContent('Relation: in_network');
      expect(panel).toHaveTextContent('203.0.113.50');
      expect(panel).toHaveTextContent('Example Hosting'); // the ASN node's title
    });

    it('expanding a node calls the graph route from that node and merges without duplicates', async () => {
      const extra: GraphTraverseResponse = {
        truncated: false,
        nodes: [graph.nodes[0]!, { id: 'tenant1:IpAddress:198.51.100.99', label: 'IpAddress', properties: {} }],
        edges: [{ src_id: graph.nodes[0]!.id, dst_id: 'tenant1:IpAddress:198.51.100.99', edge_type: 'related' }],
      };
      let n = 0;
      const api = testApi({ graph: () => (n++ === 0 ? graph : extra) });
      mount(api);
      const first = await waitFor(() => { const c = lastGraphChart(); if (!c) throw new Error('no chart'); return c; });
      const before = (first.option as { series: Array<{ data: unknown[] }> }).series[0]!.data.length;
      first.events!.click!({ dataType: 'node', data: { id: 'tenant1:Asn:AS64500' } });
      await userEvent.click(await screen.findByRole('button', { name: 'Expand neighbours' }));
      await waitFor(() => expect(api.calls.filter((c) => c.name === 'graph')).toHaveLength(2));
      expect(api.calls.filter((c) => c.name === 'graph')[1]!.body).toEqual({ start_id: 'tenant1:Asn:AS64500', max_hops: 1, limit: 200 });
      await waitFor(() => {
        const data = (lastGraphChart().option as { series: Array<{ data: Array<{ id: string }> }> }).series[0]!.data;
        expect(data).toHaveLength(before + 1);
        expect(new Set(data.map((d) => d.id)).size).toBe(data.length);
      });
    });

    it('says truncated when the API says so', async () => {
      mount(testApi({ graph: () => ({ ...graph, truncated: true }) }));
      expect(await screen.findByText(/Truncated/)).toBeInTheDocument();
    });

    it('shows an error state when expanding fails, keeping the graph', async () => {
      let n = 0;
      const api = testApi({ graph: () => { if (n++ === 0) return graph; throw new Error('x'); } });
      mount(api);
      const c = await waitFor(() => { const x = lastGraphChart(); if (!x) throw new Error('no chart'); return x; });
      c.events!.click!({ dataType: 'node', data: { id: 'tenant1:Asn:AS64500' } });
      await userEvent.click(await screen.findByRole('button', { name: 'Expand neighbours' }));
      expect(await screen.findByTestId('error-state')).toBeInTheDocument();
      expect(screen.getByTestId('entity-graph')).toBeInTheDocument();
    });

    it('is Unmeasured when the profile has no graph id, and no graph request is made', async () => {
      mount(testApi({ entityProfile: () => ({ ...profile, graph_id: null }) }));
      await screen.findByText('Source mix');
      const section = screen.getByRole('region', { name: 'Graph' });
      expect(within(section).getByTestId('unmeasured')).toBeInTheDocument();
    });

    it('shows the empty state for a graph with no nodes', async () => {
      mount(testApi({ graph: () => ({ nodes: [], edges: [], truncated: false }) }));
      expect(await screen.findByText(/No graph neighbours/)).toBeInTheDocument();
    });
  });
});

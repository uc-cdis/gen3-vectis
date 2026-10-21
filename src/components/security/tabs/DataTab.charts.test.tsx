import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSecurity } from '@/components/security/testing/render';
import type { SiemApi } from '@/lib/vectis-kit/api/client';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import DataTab, { indexOptions } from './DataTab';

vi.mock('@/lib/vectis-kit/data-table/PerspectiveGrid', () => ({
  PerspectiveGrid: (p: { rows: unknown[] }) => <div data-testid="grid-mock" data-rows={p.rows.length} />,
}));
const drawn: { option: Record<string, any> }[] = [];
const chartFault = vi.hoisted(() => ({ on: false }));
vi.mock('@gen3/frontend', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ReactECharts: (p: { option: Record<string, any> }) => {
    if (chartFault.on) throw new Error('chart library failed');
    drawn.push(p);
    return <div data-testid="echart" />;
  },
}));

const WINDOW = { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' };
const view = (id: string, title: string, index_name: string, charts: unknown[], extra: Record<string, unknown> = {}) => ({
  id, title, kind: 'data', scope: 'shared', is_default: true, spec: { index_name, window: WINDOW, ...extra }, layout: { charts },
});
const TREEMAP = { kind: 'treemap', group_by: ['country', 'asn'], title: 'Country and network', top_n: 12 };

const mount = (views: unknown[], aggregate?: (b: any) => unknown) => {
  const base = createFixtureApi(0);
  const calls: { name: string; body?: any }[] = [];
  const api: SiemApi = {
    mode: 'fixtures',
    call: (async (name: string, input: any) => {
      calls.push({ name, body: input?.body });
      if (name === 'views') return { views };
      if (name === 'aggregate' && aggregate) return aggregate(input.body);
      return (base.call as (n: string, i: unknown) => unknown)(name, input);
    }) as SiemApi['call'],
  };
  renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
  return calls;
};
const applyView = async (title: RegExp) => {
  await waitFor(() => screen.getByTestId('grid-mock'));
  await userEvent.click(screen.getByRole('tab', { name: /Views/ }));
  await userEvent.click(await screen.findByRole('button', { name: title }));
};
const aggregateFor = (b: any) => ({
  index_name: b.index_name, group_by: b.group_by, total: 30, truncated: false, as_of: '2026-10-09T18:00:00Z', notes: [],
  rows: [{ values: ['US', 'AS1'], count: 20 }, { values: ['DE', 'AS2'], count: 10 }],
});

beforeEach(() => { drawn.length = 0; chartFault.on = false; });

describe('the index picker', () => {
  it('groups indexes by what kind of data they hold, events first, in the catalog order', () => {
    const groups = indexOptions([
      { index_name: 'http_activity', label: 'HTTP', category: 'events' }, { index_name: 'all_events', label: 'All', category: 'events' },
      { index_name: 'ip_address', label: 'IP address', category: 'entities' }, { index_name: 'indicator', label: 'Indicator', category: 'threat_intel' },
      { index_name: 'old', label: 'Old' },
    ]);
    expect(groups.map((g) => g.group)).toEqual(['Events', 'Entities', 'Threat intelligence']);
    expect(groups[0]?.items.map((i) => i.value)).toEqual(['http_activity', 'all_events', 'old']);   // no category means events
  });

  it('lists the entity and threat-intel indexes the catalog offers', async () => {
    mount([]);
    await waitFor(() => screen.getByTestId('grid-mock'));
    const input = screen.getAllByLabelText('Index').find((e) => e.tagName === 'INPUT')!;
    await userEvent.click(input);
    const list = document.getElementById(input.getAttribute('aria-controls')!)!;
    expect(within(list).getByRole('option', { name: 'IP address', hidden: true })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: 'Indicator', hidden: true })).toBeInTheDocument();
  });
});

describe('saved views with charts', () => {
  it('draws each chart of the view over the page window and filters, in the database', async () => {
    const calls = mount([view('risky', 'Risky addresses', 'ip_address', [TREEMAP, { kind: 'heatmap', group_by: ['country', 'is_internal'], title: 'Heat', top_n: 15 }])],
      aggregateFor);
    await applyView(/Risky addresses/);
    await waitFor(() => expect(screen.getAllByTestId('echart')).toHaveLength(2));
    const aggs = calls.filter((c) => c.name === 'aggregate' && c.body.index_name === 'ip_address');
    expect(aggs.map((c) => c.body.group_by)).toEqual(expect.arrayContaining([['country', 'asn'], ['country', 'is_internal']]));
    expect(aggs[0]?.body).toMatchObject({ top_n: expect.any(Number), filters: [] });
    expect(aggs[0]?.body.window).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Country and network' })).toBeInTheDocument();
    expect(drawn.map((d) => d.option.series[0].type)).toEqual(expect.arrayContaining(['treemap', 'heatmap']));
  });

  it('counts records, not events, for an entity index, and gives each chart its data as a table', async () => {
    mount([view('risky', 'Risky addresses', 'ip_address', [TREEMAP])], aggregateFor);
    await applyView(/Risky addresses/);
    await screen.findByTestId('saved-chart-treemap');
    expect(screen.getByTestId('saved-chart-treemap')).toHaveTextContent('30 of 30 records');
    expect(screen.getByRole('table', { name: /data table/ })).toHaveTextContent('AS2');
  });

  it('a chart the index cannot support is left out, and the table is still there', async () => {
    const calls = mount([view('web', 'Web', 'http_activity', [{ ...TREEMAP, group_by: ['no_such_column', 'country'] }])], aggregateFor);
    await applyView(/Web/);
    await waitFor(() => expect(screen.getByTestId('grid-mock')).toBeInTheDocument());
    expect(screen.queryByTestId('saved-charts')).toBeNull();
    expect(calls.some((c) => c.name === 'aggregate')).toBe(false);
  });

  it('says so when a chart has nothing to draw', async () => {
    mount([view('risky', 'Risky addresses', 'ip_address', [TREEMAP])], (b) => ({ ...aggregateFor(b), rows: [], total: 0 }));
    await applyView(/Risky addresses/);
    expect(await screen.findByText(/No records to chart/)).toBeInTheDocument();
  });

  it('a chart that throws while drawing does not take the page down: the table and the other charts stay', async () => {
    chartFault.on = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount([view('web', 'Web', 'http_activity', [{ ...TREEMAP, group_by: ['country', 'rule_action'] }])], aggregateFor);
    await applyView(/Web/);
    await waitFor(() => expect(screen.getByTestId('saved-chart-treemap')).toBeInTheDocument());
    expect(screen.getByTestId('grid-mock')).toBeInTheDocument();
    expect(screen.getByTestId('data-tab')).toBeInTheDocument();
    errors.mockRestore();
  });

  it('says a column has no values yet, instead of drawing one empty cell, when the source leaves it blank', async () => {
    mount([view('risky', 'Risky addresses', 'ip_address', [TREEMAP])], (b) => ({ ...aggregateFor(b), total: 30, rows: [{ values: ['US', null], count: 30 }] }));
    await applyView(/Risky addresses/);
    expect(await screen.findByText(/ASN has no values yet/)).toBeInTheDocument();
    expect(screen.getByText(/None of the 30 records/)).toBeInTheDocument();
    expect(screen.getByTestId('chart-unfilled')).toBeInTheDocument();
    expect(screen.queryByTestId('echart')).toBeNull();
  });

  it('says the time range does not apply to reference data', async () => {
    mount([view('feeds', 'Feeds', 'indicator', [{ kind: 'bar', group_by: ['source_feed', 'tlp'], title: 'Feeds', top_n: 15 }])], aggregateFor);
    await applyView(/Feeds/);
    expect(await screen.findByText('Time: Not applied (reference data)')).toBeInTheDocument();
  });

  it('shows an error state for a chart whose query fails, without hiding the table', async () => {
    mount([view('web', 'Web', 'http_activity', [{ ...TREEMAP, group_by: ['country', 'rule_action'] }])], () => { throw new Error('boom'); });
    await applyView(/Web/);
    await waitFor(() => expect(screen.getByTestId('saved-chart-treemap')).toBeInTheDocument());
    expect(screen.getByTestId('grid-mock')).toBeInTheDocument();
  });

  it('charts follow the filters the user adds', async () => {
    const calls = mount([view('web', 'Web', 'http_activity', [{ kind: 'bar', group_by: ['rule_action', 'country'], title: 'Bars', top_n: 15 }])], aggregateFor);
    await applyView(/Web/);
    await waitFor(() => expect(calls.some((c) => c.name === 'aggregate')).toBe(true));
    await userEvent.click(await screen.findByRole('tab', { name: /Filters/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^BLOCK/ }));
    await waitFor(() => expect(calls.filter((c) => c.name === 'aggregate').at(-1)?.body.filters).toEqual([expect.objectContaining({ field: 'rule_action' })]));
  });
});

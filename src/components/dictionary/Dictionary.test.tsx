import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@gen3/frontend', async (orig) => {
  const { mockCharts } = await import('@/components/security/entities/testUtils');
  return { ...(await orig<Record<string, unknown>>()), ...mockCharts() };
});
import { chartCalls, lastGraphChart } from '@/components/security/entities/testUtils';
import { getMockUrl, setMockUrl } from '@/test/nextRouterMock';
import { SAMPLE_DICTIONARY as sample } from '@/lib/dictionary/sample';
import type { DictionaryLoader } from '@/lib/dictionary/load';
import { LoadError } from '@/lib/dictionary/load';
import { DictionaryScreen } from './DictionaryScreen';
import { decode, sampleLoader, wrap } from './testUtils';

beforeEach(() => { chartCalls.props.length = 0; setMockUrl('/DataDictionary'); });
afterEach(() => vi.restoreAllMocks());

describe('the Dictionary page', () => {
  it('shows the entities of the new dictionary with the version and schema', async () => {
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    expect(await screen.findAllByTestId('entity-item')).toHaveLength(8);
    expect(screen.getByTestId('dictionary-counts')).toHaveTextContent('8 entities, 22 properties, 9 graph labels');
    expect(screen.getByTestId('dictionary-version')).toHaveTextContent('version: sample-ddv2-v1');
    expect(screen.getByTestId('dictionary-version')).toHaveTextContent('schema: tenant-observation-envelope');
    expect(screen.getByText(/Carried by graph labels \(/)).toBeInTheDocument();
    expect(screen.getByText(/Not carried by any graph label \(/)).toBeInTheDocument();
  });

  it('selects the first entity, then the one clicked, and records it in the URL', async () => {
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'account' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^http_activity/ }));
    expect(screen.getByRole('heading', { level: 3, name: 'http_activity' })).toBeInTheDocument();
    expect(getMockUrl()).toContain('entity=http_activity');
    expect(screen.getAllByTestId('property-row')).toHaveLength(9);
    expect(screen.getByRole('button', { name: /^http_activity/ })).toHaveAttribute('aria-current', 'true');
  });

  it('opens the entity named in the URL, and says so (as text) when it does not exist', async () => {
    setMockUrl('/DataDictionary?entity=principal');
    const { unmount } = wrap(<DictionaryScreen loader={sampleLoader()} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'principal' })).toBeInTheDocument();
    unmount();
    setMockUrl('/DataDictionary?entity=%3Cimg%20src%3Dx%3E');
    const { container } = wrap(<DictionaryScreen loader={sampleLoader()} />);
    expect(await screen.findByText(/No entity named/)).toHaveTextContent('<img src=x>');
    expect(container.querySelector('img')).toBeNull();
  });

  it('searches entities and properties', async () => {
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    const box = await screen.findByLabelText('Search entities and properties');
    await userEvent.type(box, 'forwarderHost');
    const items = screen.getAllByTestId('entity-item');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(8);
    expect(items[0]).toHaveTextContent('property: forwarderHost');
    await userEvent.clear(box);
    await userEvent.type(box, 'zzzz-no-such-thing');
    expect(screen.getByTestId('no-entities')).toBeInTheDocument();
  });

  it('shows type, nullable, enum, default, required and envelope flags per property, camelCase intact', async () => {
    setMockUrl('/DataDictionary?entity=http_activity');
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    const row = (name: string) => screen.getAllByTestId('property-row').find((r) => within(r).queryByText(name, { exact: true }))!;
    await screen.findByTestId('property-table');
    expect(within(row('forwarderHost')).getByText('nullable')).toBeInTheDocument();
    expect(within(row('outcome')).getByText(/one of allow, block, error, unknown/)).toBeInTheDocument();
    expect(within(row('tenantId')).getByText('required')).toBeInTheDocument();
    expect(within(row('tenantId')).getByText('envelope')).toBeInTheDocument();
    expect(screen.queryByText('forwarder_host')).toBeNull();
    expect(screen.getByTestId('entity-labels')).toHaveTextContent('WafRequest');
  });

  it('sorts the property table, with aria-sort, and returns to the dictionary order', async () => {
    setMockUrl('/DataDictionary?entity=http_activity');
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    await screen.findByTestId('property-table');
    const names = () => screen.getAllByTestId('property-row').map((r) => r.querySelector('td')!.textContent!);
    const declared = names();
    const header = () => screen.getByRole('columnheader', { name: /Property/ });
    expect(header()).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Property' }));
    expect(header()).toHaveAttribute('aria-sort', 'ascending');
    expect(names()).toEqual([...declared].sort((a, b) => a.localeCompare(b)));
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Property' }));
    expect(header()).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Property' }));
    expect(header()).toHaveAttribute('aria-sort', 'none');
    expect(names()).toEqual(declared);
  });

  it('filters the properties of the open entity', async () => {
    setMockUrl('/DataDictionary?entity=http_activity');
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    await userEvent.type(await screen.findByLabelText('Filter the properties of http_activity'), 'ja3');
    expect(screen.getAllByTestId('property-row')).toHaveLength(1);
    await userEvent.type(screen.getByLabelText('Filter the properties of http_activity'), 'zzz');
    expect(screen.getByTestId('no-match')).toBeInTheDocument();
  });

  it('shows an entity without properties honestly', async () => {
    setMockUrl('/DataDictionary?entity=gen3model');
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    expect(await screen.findByTestId('no-properties')).toBeInTheDocument();
  });

  it('renders the relationships view from the graph contract', async () => {
    setMockUrl('/DataDictionary?view=relationships');
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    expect(await screen.findByTestId('dictionary-relationships')).toBeInTheDocument();
    const graphs = chartCalls.props.filter((p) => (p.option as { series?: Array<{ type?: string }> }).series?.[0]?.type === 'graph');
    const last = (i: number) => (graphs[i]!.option as { series: Array<{ layout: string; data: Array<{ name: string }>; links: Array<{ lineStyle: { type?: string } }> }> }).series[0]!;
    expect(last(0).layout).toBe('circular');
    expect(last(0).data.map((n) => n.name)).toEqual(expect.arrayContaining(['IpAddress', 'WafRequest', 'Resource', 'Principal']));
    expect(last(0).links.filter((l) => l.lineStyle.type === 'dashed')).toHaveLength(2);
    const intel = chartCalls.props.filter((p) => (p.option as { series?: Array<{ data?: Array<{ name: string }> }> }).series?.[0]?.data?.some((n) => n.name === 'open:stixRelationship')).pop()!;
    expect((intel.option as { series: Array<{ data: unknown[] }> }).series[0]!.data).toHaveLength(4);
    expect(lastGraphChart()).toBeTruthy();
    expect(screen.getByTestId('open-only-cluster')).toHaveTextContent('Observation also has declared edges');
    expect(screen.getByTestId('isolated-labels')).toHaveTextContent('ServiceLog');
    expect(screen.getByTestId('isolated-labels')).toHaveTextContent('declares no edge type or open edge family');
    expect(screen.getAllByTestId('label-row')).toHaveLength(9);
    expect(screen.getAllByTestId('edge-row')).toHaveLength(5);
    const families = screen.getAllByTestId('family');
    expect(families).toHaveLength(3);
    expect(families[1]).toHaveTextContent('^flow:[A-Za-z0-9_]+(:[A-Za-z0-9_]+)?$');
    expect(families[1]).toHaveTextContent('flowed_to');
    expect(screen.getAllByTestId('dictionary-note').join()).toBeTruthy();
  });

  it('moves between a label and its entities in both directions', async () => {
    setMockUrl('/DataDictionary?view=relationships');
    wrap(<DictionaryScreen loader={sampleLoader()} />);
    const row = (await screen.findAllByTestId('label-row')).find((r) => within(r).queryByText('WafRequest'))!;
    await userEvent.click(within(row).getByRole('button', { name: 'http_activity' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'http_activity' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show graph label WafRequest in Relationships' }));
    expect(getMockUrl()).toContain('view=relationships');
    expect(getMockUrl()).toContain('label=WafRequest');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Highlight label WafRequest in the graph' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('says so when the dictionary declares no graph vocabulary', async () => {
    setMockUrl('/DataDictionary?view=relationships');
    wrap(<DictionaryScreen loader={async () => decode({ entities: { a: { properties: {} } } })} />);
    expect(await screen.findByTestId('no-contract')).toBeInTheDocument();
  });

  it('renders hostile text from the dictionary as plain text', async () => {
    const hostile = { version: '<b>v</b>', entities: { thing: { description: '<img src=x onerror=alert(1)>', properties: { a: { type: 'string', description: '<script>boom()</script>', enum: ['<i>x</i>'] } } } } };
    const { container } = wrap(<DictionaryScreen loader={async () => decode(hostile)} />);
    expect(await screen.findByText('<script>boom()</script>')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img, script, b, i')).toBeNull();
  });
});

describe('the states', () => {
  it('shows loading, then the page', async () => {
    let release: () => void = () => undefined;
    wrap(<DictionaryScreen loader={() => new Promise((res) => { release = () => res(decode(sample)); })} />);
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    release();
    expect(await screen.findByTestId('dictionary-explorer')).toBeInTheDocument();
  });
  it('shows a clear error, never the payload, and retries', async () => {
    const loader = vi.fn<DictionaryLoader>().mockRejectedValueOnce(new LoadError('The dictionary could not be reached.')).mockResolvedValue(decode(sample));
    wrap(<DictionaryScreen loader={loader} />);
    const err = await screen.findByTestId('dictionary-error');
    expect(err).toHaveTextContent('The dictionary could not be shown. The dictionary could not be reached.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('dictionary-explorer')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('turns an unexpected failure into a generic message', async () => {
    wrap(<DictionaryScreen loader={async () => { throw new Error('internal detail: db password'); }} />);
    const err = await screen.findByTestId('dictionary-error');
    expect(err).toHaveTextContent('could not be loaded');
    expect(err).not.toHaveTextContent('db password');
  });
  it('shows an empty state for a dictionary with no entities', async () => {
    wrap(<DictionaryScreen loader={async () => decode({ entities: {} })} />);
    expect(await screen.findByTestId('dictionary-empty')).toBeInTheDocument();
  });
});

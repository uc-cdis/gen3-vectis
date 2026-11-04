import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SWRConfig } from 'swr';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import { SiemApiProvider } from '@/lib/vectis-kit/api/hooks';
import { getMockUrl, setMockUrl } from '@/test/nextRouterMock';
import { SECTIONS, SECTION_PATHS, SecurityProvider, TABS, pathOfTab, useSecurity } from './context';

const Probe = () => {
  const s = useSecurity();
  return <div><span data-testid="tab">{s.tab}</span><button onClick={() => s.goTab('hunt', { similar: 'g-1' })}>hunt</button><button onClick={() => s.goTab('views')}>views</button><button onClick={() => s.goTab('data', { hunt_index: 'http_activity' })}>data</button></div>;
};
const mount = (url: string, section: readonly (typeof TABS)[number]['id'][]) => {
  setMockUrl(url);
  render(<SWRConfig value={{ provider: () => new Map() }}><MantineProvider><SiemApiProvider api={createFixtureApi(0)}>
    <SecurityProvider section={section}><Probe /></SecurityProvider></SiemApiProvider></MantineProvider></SWRConfig>);
};

describe('sections', () => {
  it('every tab lives on exactly one page', () => {
    for (const t of TABS) expect(SECTION_PATHS.filter((p) => (SECTIONS[p].tabs as readonly string[]).includes(t.id))).toHaveLength(1);
    expect(pathOfTab('coverage')).toBe('/Detection');
    expect(pathOfTab('views')).toBe('/Investigate');
  });
  it('the pipeline health is its own page, not a Detection tab', () => {
    expect(pathOfTab('health')).toBe('/Health');
    expect(SECTIONS['/Health'].tabs).toEqual(['health']);
    expect(SECTIONS['/Detection'].tabs as readonly string[]).not.toContain('health');
  });
  it('a page shows its own tab and ignores a ?tab= that belongs to another page', () => {
    mount('/Alerts?tab=health', SECTIONS['/Alerts'].tabs);
    expect(screen.getByTestId('tab').textContent).toBe('alerts');
  });
  it('moving to a tab on another page navigates there, carrying the range and the ask, never the drawer', async () => {
    mount('/Alerts?range=7d&alert=g-9', SECTIONS['/Alerts'].tabs);
    await act(async () => { screen.getByText('hunt').click(); });
    expect(getMockUrl()).toBe('/Investigate?range=7d&similar=g-1');
  });
  it('moving to a later tab of another page names that tab, so the page does not open on its first', async () => {
    mount('/Alerts?range=7d', SECTIONS['/Alerts'].tabs);
    await act(async () => { screen.getByText('data').click(); });
    expect(getMockUrl()).toBe('/Investigate?range=7d&tab=data&hunt_index=http_activity');
  });
  it('moving within a page only changes the tab', async () => {
    mount('/Investigate?range=24h', SECTIONS['/Investigate'].tabs);
    await act(async () => { screen.getByText('views').click(); });
    expect(screen.getByTestId('tab').textContent).toBe('views');
  });
});

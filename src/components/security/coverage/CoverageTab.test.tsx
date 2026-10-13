import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig, mutate } from 'swr';
import { ApiError } from '@/lib/vectis-kit/api';
import type { CallInput, RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { CoverageResponse } from '@/lib/vectis-kit/spec';
import { renderSecurity } from '../testing/render';
import CoverageTab from '../tabs/CoverageTab';

beforeEach(async () => { await mutate(() => true, undefined, { revalidate: false }); });
afterEach(() => { vi.restoreAllMocks(); });

function withCoverage(c: () => unknown): SiemApi {
  const base = createFixtureApi(0);
  return { mode: 'fixtures', call: (name: RouteName, input?: CallInput<RouteName>) => (name === 'coverage' ? Promise.resolve(c() as never) : base.call(name, input as never)) };
}
const mount = (api?: SiemApi) => renderSecurity(<SWRConfig value={{ dedupingInterval: 0 }}><CoverageTab /></SWRConfig>, { url: '/Security?tab=coverage', api });

describe('Coverage tab', () => {
  it('shows caught and missed totals, and the share', async () => {
    mount();
    expect(await screen.findByTestId('caught')).toHaveTextContent('6');
    expect(screen.getByTestId('missed')).toHaveTextContent('1');
    expect(screen.getByText('86%')).toBeInTheDocument();
  });

  it('labels every technique with its verdict in words, not only colour', async () => {
    mount();
    const grid = await screen.findByRole('list', { name: 'Techniques' });
    const tile = (id: string) => within(grid).getByText(id).closest('li') as HTMLElement;
    expect(within(tile('T1190')).getByText('Caught by both')).toBeInTheDocument();
    expect(within(tile('T1595')).getByText('Rule only')).toBeInTheDocument();
    expect(within(tile('T1041')).getByText('Behavioral only')).toBeInTheDocument();
    expect(within(tile('T1078')).getByText('Missed')).toBeInTheDocument();
    expect(tile('T1078')).toHaveAttribute('data-verdict', 'missed');
    expect(within(tile('T1190')).getByText(/Replay sample-intrusion, step 3/)).toBeInTheDocument();
    expect(within(grid).getAllByRole('listitem')).toHaveLength(7);
  });

  it('has a legend explaining all four verdicts', async () => {
    mount();
    const legend = await screen.findByRole('list', { name: 'Verdict legend' });
    for (const label of ['Caught by both', 'Rule only', 'Behavioral only', 'Missed']) expect(within(legend).getByText(label)).toBeInTheDocument();
    expect(within(legend).getByText(/Replayed, but nothing detected it/)).toBeInTheDocument();
  });

  it('exports a Navigator layer download built from the data', async () => {
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { created.push(b as Blob); return 'blob:x'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let downloaded = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded = this.download; });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Export ATT&CK Navigator layer/ }));
    expect(downloaded).toBe('vectis-attack-navigator-layer.json');
    expect(created).toHaveLength(1);
    const text = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(created[0]!); });
    const layer = JSON.parse(text);
    expect(layer.versions.layer).toBe('4.5');
    expect(layer.domain).toBe('enterprise-attack');
    expect(layer.techniques).toHaveLength(7);
    expect(layer.techniques.find((t: { techniqueID: string }) => t.techniqueID === 'T1078')).toMatchObject({ score: 0 });
    expect(await screen.findByText('Exported 7 techniques.')).toBeInTheDocument();
  });

  it('says so when rows were left out of the export', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const cov: CoverageResponse = { caught: 1, missed: 0, run_at: '2026-10-09T12:00:00Z', rows: [
      { technique_id: 'T1595', verdict: 'rule', replay: 'r', step: 1 }, { technique_id: '<b>bad</b>', verdict: 'rule', replay: 'r', step: 2 }] };
    mount(withCoverage(() => cov));
    await userEvent.click(await screen.findByRole('button', { name: /Export ATT&CK Navigator layer/ }));
    expect(await screen.findByText(/1 invalid row was left out/)).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('shows an empty state, not zeros, when no replay has run', async () => {
    mount(withCoverage(() => ({ caught: 0, missed: 0, rows: [], run_at: '2026-10-09T12:00:00Z' } satisfies CoverageResponse)));
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(/No coverage replay has been run/);
    expect(screen.queryByTestId('caught')).toBeNull();
  });

  it('shows the share as unmeasured when totals are zero but rows exist', async () => {
    mount(withCoverage(() => ({ caught: 0, missed: 0, run_at: '2026-10-09T12:00:00Z', rows: [{ technique_id: 'T1595', verdict: 'rule', replay: 'r', step: 1 }] } satisfies CoverageResponse)));
    await screen.findByTestId('caught');
    expect(screen.getByTestId('unmeasured')).toBeInTheDocument();
  });

  it('shows loading, then an error state when the API rejects', async () => {
    const base = createFixtureApi(0);
    const api: SiemApi = { mode: 'fixtures', call: (n: RouteName, i?: CallInput<RouteName>) => (n === 'coverage' ? Promise.reject(new ApiError(503, 'coverage unavailable', 'coverage')) : base.call(n, i as never)) };
    mount(api);
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/coverage unavailable/);
    await waitFor(() => expect(screen.queryByTestId('caught')).toBeNull());
  });
});

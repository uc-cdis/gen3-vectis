import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { getMockQuery } from '@/test/nextRouterMock';
import { rejecting, testApi } from '../entities/testUtils';
import { renderSecurity } from '../testing/render';
import IntelTab from './IntelTab';

const paste = (text: string) => fireEvent.change(screen.getByLabelText(/Values, one per line/), { target: { value: text } });
const publish = () => userEvent.click(screen.getByRole('button', { name: 'Publish to watchlist' }));

describe('IntelTab', () => {
  it('says that publishing writes a STIX bundle for the next detection run', () => {
    renderSecurity(<IntelTab />, { api: testApi() });
    expect(screen.getAllByText(/STIX bundle/)[0]).toHaveTextContent(/next detection run/);
  });

  it('posts valid entries and shows accepted, rejected with reasons, and the bundle key', async () => {
    const api = testApi({ watchlist: () => ({ accepted: 1, rejected: { 'bad value': 'not a valid address' }, bundle_key: 'raw/stix/b1.json' }) });
    renderSecurity(<IntelTab />, { api });
    paste('192.0.2.1\n\n192.0.2.2\n');
    await publish();
    const result = await screen.findByTestId('watchlist-result');
    expect(result).toHaveTextContent('1 accepted, 1 rejected');
    expect(result).toHaveTextContent('raw/stix/b1.json');
    expect(within(result).getByText('not a valid address')).toBeInTheDocument();
    expect(api.calls.find((c) => c.name === 'watchlist')?.body).toEqual({
      entries: [
        { type: 'ip', value: '192.0.2.1', confidence: 75, expires_at: null, note: '' },
        { type: 'ip', value: '192.0.2.2', confidence: 75, expires_at: null, note: '' },
      ],
    });
  });

  it('refuses an empty submission and sends nothing', async () => {
    const api = testApi();
    renderSecurity(<IntelTab />, { api });
    await publish();
    expect(await screen.findByTestId('watchlist-problems')).toHaveTextContent(/at least one value/);
    expect(api.calls.some((c) => c.name === 'watchlist')).toBe(false);
  });

  it('refuses a 513 character value, naming the line', async () => {
    const api = testApi();
    renderSecurity(<IntelTab />, { api });
    paste(`192.0.2.1\n${'a'.repeat(513)}`);
    await publish();
    expect(await screen.findByTestId('watchlist-problems')).toHaveTextContent(/Line 2.*513 characters/);
    expect(api.calls.some((c) => c.name === 'watchlist')).toBe(false);
  });

  it('refuses 1001 entries and a past expiry', async () => {
    const api = testApi();
    renderSecurity(<IntelTab />, { api });
    paste(Array.from({ length: 1001 }, (_, i) => `10.0.${i >> 8}.${i & 255}`).join('\n'));
    await publish();
    expect(await screen.findByTestId('watchlist-problems')).toHaveTextContent(/Too many entries/);

    paste('192.0.2.1');
    fireEvent.change(screen.getByLabelText(/Expires/), { target: { value: '2020-01-01T00:00' } });
    await publish();
    await waitFor(() => expect(screen.getByTestId('watchlist-problems')).toHaveTextContent(/future/));
    expect(api.calls.some((c) => c.name === 'watchlist')).toBe(false);
  });

  it('refuses confidence 101', async () => {
    const api = testApi();
    renderSecurity(<IntelTab />, { api });
    paste('192.0.2.1');
    const c = screen.getByLabelText(/Confidence/);
    await userEvent.clear(c);
    await userEvent.type(c, '101');
    await publish();
    expect(await screen.findByTestId('watchlist-problems')).toHaveTextContent(/0 to 100/);
    expect(api.calls.some((x) => x.name === 'watchlist')).toBe(false);
  });

  it('shows the error state when the API rejects the submission', async () => {
    renderSecurity(<IntelTab />, { api: testApi({ watchlist: rejecting(500, 'bundle write failed', 'watchlist') }) });
    paste('192.0.2.1');
    await publish();
    expect(await screen.findAllByTestId('error-state')).not.toHaveLength(0);
    expect(screen.getByText(/bundle write failed/)).toBeInTheDocument();
  });

  it('lists alert groups that matched an indicator, with a link to the alert', async () => {
    renderSecurity(<IntelTab />, { api: testApi(), url: '/Security?tab=intel' });
    const table = await screen.findByRole('table', { name: 'Alert groups with matched indicators' });
    expect(within(table).getByRole('button', { name: '192.0.2.44' })).toBeInTheDocument();
    expect(within(table).queryByText(/Recon followed/)).toBeNull(); // groups without indicators are not listed
    await userEvent.click(within(table).getByRole('button', { name: /Open alert Traffic from an address/ }));
    await waitFor(() => expect(getMockQuery().alert).toBe('g-ioc-match'));
  });

  it('shows the matched VALUE first and the indicator id second, resolving ids once', async () => {
    const api = testApi();
    renderSecurity(<IntelTab />, { api, url: '/Security?tab=intel' });
    const table = await screen.findByRole('table', { name: 'Alert groups with matched indicators' });
    const cell = await within(table).findByTestId('matched-value');
    await waitFor(() => expect(cell).toHaveTextContent(/^192\.0\.2\.44example-feed · tenant1:Indicator:/));
    const calls = api.calls.filter((c) => c.name === 'resolveIndicators');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ ids: ['tenant1:Indicator:0a1b2c3d4e5f60718293a4b5'] });
  });

  it('falls back to the id, saying the value is not recorded, when the lookup fails', async () => {
    renderSecurity(<IntelTab />, { api: testApi({ resolveIndicators: rejecting(500, 'intel down', 'resolveIndicators') }), url: '/Security?tab=intel' });
    const table = await screen.findByRole('table', { name: 'Alert groups with matched indicators' });
    await waitFor(() => expect(within(table).getByTestId('matched-value')).toHaveTextContent(/Value not recorded/));
    expect(within(table).getByTestId('matched-value')).toHaveTextContent('tenant1:Indicator:0a1b2c3d4e5f60718293a4b5');
    expect(within(table).queryByRole('button', { name: '192.0.2.44' })).toBeNull();
  });

  it('shows empty and error states for the alerts table', async () => {
    const { unmount } = renderSecurity(<IntelTab />, { api: testApi({ alerts: () => ({ groups: [], total: 0, truncated: false, as_of: '2026-10-09T00:00:00Z', source_version: 1 } as never) }) });
    expect(await screen.findByText(/No alerts matched an indicator/)).toBeInTheDocument();
    unmount();
    renderSecurity(<IntelTab />, { api: testApi({ alerts: rejecting(500, 'alerts down', 'alerts') }) });
    expect(await screen.findByText(/alerts down/)).toBeInTheDocument();
  });
});

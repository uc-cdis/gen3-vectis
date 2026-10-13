import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getMockQuery } from '@/test/nextRouterMock';
import { rejecting, testApi } from '../entities/testUtils';
import { renderSecurity } from '../testing/render';
import EntitiesTab from './EntitiesTab';

describe('EntitiesTab', () => {
  it('validates the search and opens the drawer for a valid entity', async () => {
    renderSecurity(<EntitiesTab />, { url: '/Security?tab=entities', api: testApi() });
    await userEvent.click(screen.getByRole('button', { name: 'Investigate' }));
    expect(screen.getByText('Enter a value to look up.')).toBeInTheDocument();
    expect(getMockQuery().entity).toBeUndefined();

    await userEvent.type(screen.getByLabelText('Value'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Investigate' }));
    expect(screen.getByText(/not a valid IPv4 or IPv6/)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Value'));
    await userEvent.type(screen.getByLabelText('Value'), '203.0.113.50');
    await userEvent.click(screen.getByRole('button', { name: 'Investigate' }));
    await waitFor(() => expect(getMockQuery().entity).toBe('ip:203.0.113.50'));
  });

  it('lists seen-recently entities derived from medium-and-above alerts only', async () => {
    const api = testApi();
    renderSecurity(<EntitiesTab />, { url: '/Security?tab=entities', api });
    const table = await screen.findByRole('table', { name: 'Entities seen recently' });
    expect(within(table).getByRole('button', { name: '203.0.113.50' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: '192.0.2.44' })).toBeInTheDocument();
    const call = api.calls.find((c) => c.name === 'alerts')!.body as { min_severity: string; window: unknown };
    expect(call.min_severity).toBe('medium');
    await userEvent.click(within(table).getByRole('button', { name: '192.0.2.44' }));
    await waitFor(() => expect(getMockQuery().entity).toBe('ip:192.0.2.44'));
  });

  it('shows the empty state when no alert names an entity', async () => {
    renderSecurity(<EntitiesTab />, { api: testApi({ alerts: () => ({ groups: [], total: 0, truncated: false, as_of: '2026-10-09T00:00:00Z', source_version: 1 } as never) }) });
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });

  it('shows the error state when alerts cannot be read', async () => {
    renderSecurity(<EntitiesTab />, { api: testApi({ alerts: rejecting(0, 'offline', 'alerts') }) });
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/unavailable/i);
  });

  it('shows a loading state first', () => {
    renderSecurity(<EntitiesTab />, { api: testApi() });
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
  });
});

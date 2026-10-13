import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import { getMockQuery, setMockUrl } from '@/test/nextRouterMock';
import SecurityShell from './SecurityShell';
import { TABS } from './context';

const mount = (url: string) => { setMockUrl(url); return render(<MantineProvider><SecurityShell api={createFixtureApi(0)} /></MantineProvider>); };

describe('SecurityShell', () => {
  it('renders every section as a tab and defaults to Overview', () => {
    mount('/Security');
    for (const t of TABS) expect(screen.getByRole('tab', { name: t.label })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the tab named in the URL and writes the tab back to the URL when switched', async () => {
    mount('/Security?tab=health');
    expect(screen.getByRole('tab', { name: 'Health' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Alerts' }));
    await waitFor(() => expect(getMockQuery().tab).toBe('alerts'));
    expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores an unknown tab value instead of failing', () => {
    mount('/Security?tab=../../etc');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the alert and entity drawers from the URL', () => {
    mount('/Security?tab=alerts&alert=g-abc123&entity=ip:203.0.113.50');
    expect(screen.getByText(/Alert g-abc123/)).toBeInTheDocument();
    expect(screen.getByText(/ip: 203\.0\.113\.50/)).toBeInTheDocument();
  });
});

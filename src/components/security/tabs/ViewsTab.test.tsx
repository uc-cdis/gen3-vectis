import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { SiemApi } from '@/lib/vectis-kit/api';
import { getMockQuery } from '@/test/nextRouterMock';
import { renderSecurity } from '../testing/render';
import ViewsTab from './ViewsTab';

const view = {
  id: 'v1', title: 'Blocked only', kind: 'data', scope: 'shared',
  spec: { index_name: 'http_activity', window: { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' }, filters: [] },
};
const base = createFixtureApi(0);
const api: SiemApi = { mode: 'fixtures', call: async (name, input) => (name === 'views' ? ({ views: [view] } as never) : base.call(name, input)) };

describe('ViewsTab', () => {
  it('opening a view goes to Explore with that view id', async () => {
    renderSecurity(<ViewsTab />, { url: '/Investigate?tab=views', api });
    await userEvent.click(await screen.findByRole('button', { name: /Blocked only/ }));
    await waitFor(() => expect(getMockQuery()).toMatchObject({ tab: 'data', view: 'v1' }));
  });
});

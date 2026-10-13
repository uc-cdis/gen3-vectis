import React from 'react';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { SiemApiProvider } from '@/lib/vectis-kit/api/hooks';
import type { SiemApi } from '@/lib/vectis-kit/api/client';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import { SecurityProvider } from '../context';
import { setMockUrl } from '@/test/nextRouterMock';

/** Render a component the way the console does: Mantine theme, fixture API (no delay), URL-synced context. */
export function renderSecurity(ui: React.ReactElement, opts: { url?: string; api?: SiemApi } = {}) {
  setMockUrl(opts.url ?? '/Security?tab=overview');
  const api = opts.api ?? createFixtureApi(0);
  return {
    api,
    ...render(
      // A fresh SWR cache per render and no request de-duplication: otherwise results leak between tests.
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MantineProvider>
          <SiemApiProvider api={api}>
            <SecurityProvider>{ui}</SecurityProvider>
          </SiemApiProvider>
        </MantineProvider>
      </SWRConfig>,
    ),
  };
}

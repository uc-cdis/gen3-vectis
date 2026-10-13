import React from 'react';
import { Stack } from '@mantine/core';
import { IndicatorAlertsTable } from '../intel/IndicatorAlertsTable';
import { WatchlistForm } from '../intel/WatchlistForm';

/** Intel: publish indicators to the watchlist, and see which alerts matched one (SOC-PLAN.md 15.5). */
const IntelTab = () => (
  <Stack gap="md" data-testid="intel-tab">
    <WatchlistForm />
    <IndicatorAlertsTable />
  </Stack>
);
export default IntelTab;

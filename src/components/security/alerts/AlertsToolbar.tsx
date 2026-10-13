import React from 'react';
import { Group, Select, Switch, Text } from '@mantine/core';
import type { AlertsRequest, Severity } from '@/lib/vectis-kit/spec';
import { SEVERITY_LABEL, STATUS_LABEL, TIER_LABEL } from '@/lib/vectis-kit/spec';

type SortKey = NonNullable<AlertsRequest['sort']>;
export interface AlertFilters {
  floor: Severity;
  showLowInfo: boolean;
  tier: string; // '' = any
  status: string; // '' = any
  includeNoise: boolean;
  sort: SortKey;
}
export const DEFAULT_FILTERS: AlertFilters = { floor: 'medium', showLowInfo: false, tier: '', status: '', includeNoise: false, sort: 'severity' };

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'severity', label: 'Severity' },
  { value: 'last_seen', label: 'Last seen' },
  { value: 'occurrence_count', label: 'Occurrences' },
  { value: 'novelty_score', label: 'Novelty' },
];
const FLOORS: Severity[] = ['medium', 'high', 'critical'];

const AlertsToolbar = ({ value, onChange, summary }: { value: AlertFilters; onChange: (next: AlertFilters) => void; summary: React.ReactNode }) => {
  const set = (patch: Partial<AlertFilters>) => onChange({ ...value, ...patch });
  return (
    <Group justify="space-between" align="flex-end" gap="md" wrap="wrap" role="search" aria-label="Alert filters">
      <Group align="flex-end" gap="sm" wrap="wrap">
        <Select
          label="Severity floor"
          size="xs"
          w={170}
          allowDeselect={false}
          disabled={value.showLowInfo}
          data={FLOORS.map((s) => ({ value: s, label: `${SEVERITY_LABEL[s]} and above` }))}
          value={value.floor}
          onChange={(v) => v && set({ floor: v as Severity })}
        />
        <Switch size="sm" label="Show low and info" checked={value.showLowInfo} onChange={(e) => set({ showLowInfo: e.currentTarget.checked })} />
        <Select
          label="Detector tier"
          size="xs"
          w={140}
          data={[{ value: '', label: 'Any tier' }, ...Object.entries(TIER_LABEL).map(([value, label]) => ({ value, label }))]}
          value={value.tier}
          allowDeselect={false}
          onChange={(v) => set({ tier: v ?? '' })}
        />
        <Select
          label="Status"
          size="xs"
          w={150}
          data={[{ value: '', label: 'Any status' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]}
          value={value.status}
          allowDeselect={false}
          onChange={(v) => set({ status: v ?? '' })}
        />
        <Select label="Sort by" size="xs" w={140} data={SORTS} value={value.sort} allowDeselect={false} onChange={(v) => v && set({ sort: v as SortKey })} />
        <Switch size="sm" label="Include noise" checked={value.includeNoise} onChange={(e) => set({ includeNoise: e.currentTarget.checked })} />
      </Group>
      <Text size="sm" role="status" aria-live="polite" data-testid="alerts-summary">{summary}</Text>
    </Group>
  );
};
export default AlertsToolbar;

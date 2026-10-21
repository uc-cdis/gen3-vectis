import React, { useMemo } from 'react';
import { Anchor, Stack, Text } from '@mantine/core';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { AlertGroup } from '@/lib/vectis-kit/spec';
import { SimpleTable } from '@/lib/vectis-kit/entity-card/blocks';
import { safeText } from '@/lib/safe-text';
import { useSecurity } from '../context';
import { EmptyState, EntityLink, Panel, QueryBoundary, SeverityBadge } from '@/lib/vectis-kit/ui/primitives';
import { validNodeId } from '../entities/entityKeys';
import { relativeTime } from '@/lib/vectis-kit/ui/format';
import type { IndicatorMatch } from '@/lib/vectis-kit/spec';
import { entityTypeOf } from '@/lib/vectis-kit/spec/indicator';

const MAX_RESOLVE = 50;

/** One matched indicator: the VALUE first (what an analyst recognises), the intel id and feed second. */
const MatchedValue = ({ id, match, resolving }: { id: string; match: IndicatorMatch | undefined; resolving: boolean }) => {
  const entityType = entityTypeOf(match?.type);
  if (match && entityType) {
    return (
      <Stack gap={0} align="flex-start" data-testid="matched-value">
        <EntityLink type={entityType} value={match.value}>{safeText(match.value, 80)}</EntityLink>
        <Text size="xs" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
          {match.source ? `${safeText(match.source, 40)} · ` : ''}{match.indicator_id ? safeText(match.indicator_id, 60) : 'matched value'}
        </Text>
      </Stack>
    );
  }
  return (
    <Stack gap={0} align="flex-start" data-testid="matched-value">
      {resolving ? <Text size="sm" c="dimmed">Looking up the value</Text> : <Text size="sm" c="dimmed" fs="italic">Value not recorded</Text>}
      <Text size="xs" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{safeText(id, 60)}</Text>
    </Stack>
  );
};

/** Alert groups, in the current window, that matched at least one indicator. Real data from the alerts route only. */
export const IndicatorAlertsTable = () => {
  const { window, openAlert } = useSecurity();
  const query = useSiemQuery('alerts', { body: { window, paging: { limit: 500 } } });
  const rowsAll = useMemo(() => (query.data?.groups ?? []).filter((g) => (g.matched_indicators ?? []).length > 0), [query.data]);
  // Only node ids are sent: the backend refuses anything else.
  const ids = useMemo(() => [...new Set(rowsAll.flatMap((g) => g.matched_indicators ?? []))].filter((v) => validNodeId(v) !== null).slice(0, MAX_RESOLVE), [rowsAll]);
  const resolved = useSiemQuery('resolveIndicators', ids.length ? { body: { ids } } : null);
  const byId = useMemo(() => new Map(ids.map((id, i) => [id, resolved.data?.matches[i]] as const)), [ids, resolved.data]);
  const resolving = ids.length > 0 && resolved.data === undefined && resolved.error === undefined;
  const columns = useMemo<MRT_ColumnDef<AlertGroup>[]>(() => [
    {
      id: 'indicators', header: 'Matched value', enableSorting: false, size: 260,
      Cell: ({ row }) => (
        <Stack gap={4}>
          {(row.original.matched_indicators ?? []).slice(0, 3).map((v) => <MatchedValue key={v} id={v} match={byId.get(v)} resolving={resolving} />)}
          {(row.original.matched_indicators ?? []).length > 3 ? <Text size="xs" c="dimmed">+{(row.original.matched_indicators ?? []).length - 3} more</Text> : null}
        </Stack>
      ),
    },
    { accessorKey: 'severity', header: 'Severity', size: 100, Cell: ({ row }) => <SeverityBadge severity={row.original.severity} /> },
    { accessorKey: 'occurrence_count', header: 'Events', size: 90 },
    { accessorFn: (g) => relativeTime(g.last_seen), id: 'last_seen', header: 'Last seen', size: 110 },
    {
      id: 'alert', header: 'Alert', enableSorting: false,
      Cell: ({ row }) => (
        <Anchor component="button" type="button" size="sm" onClick={() => openAlert(row.original.group_id)} aria-label={`Open alert ${safeText(row.original.title, 100)}`}>
          {safeText(row.original.title, 80)}
        </Anchor>
      ),
    },
  ], [openAlert, byId, resolving]);

  return (
    <Panel title="Alerts that matched an indicator">
      <QueryBoundary
        query={query}
        isEmpty={(d) => !d.groups.some((g) => (g.matched_indicators ?? []).length > 0)}
        empty={<EmptyState title="No alerts matched an indicator in this time range" hint="Widen the range, or add indicators above. New indicators are used from the next detection run." />}
      >
        {(d) => {
          const rows = d.groups.filter((g) => (g.matched_indicators ?? []).length > 0);
          return (
            <>
              {d.truncated ? <Text size="xs" c="yellow.9" mb="xs">Truncated: only the first {d.groups.length} alert groups were searched.</Text> : null}
              <SimpleTable columns={columns} data={rows} caption="Alert groups with matched indicators" pageSize={10} />
            </>
          );
        }}
      </QueryBoundary>
    </Panel>
  );
};

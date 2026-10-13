import React, { useState, useMemo } from 'react';
import { Button, Group, Stack, Text, Badge, Alert } from '@mantine/core';
import { PanelErrorBoundary } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import { formatTime, formatNumber, relativeTime } from '@/lib/vectis-kit/ui/format';
import { EmptyState, Panel, QueryBoundary, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { QuarantineSection } from '../health/QuarantinePanel';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import type { HealthSource, HealthQueue } from '@/lib/vectis-kit/spec';
import { HealthTable } from '../health/HealthTable';

/** Polling is silent: the page only says when it was last updated. */
export const HEALTH_REFRESH_MS = 30_000;
/** Wall clock read at the moment a fetch completes (an external event), not a render-time computation. */
const clock = (): number => Date.now();

const HealthTab = () => {
  const query = useSiemQuery('health', {}, { refreshMs: HEALTH_REFRESH_MS });
  // Client-side "last refreshed": set when a fetch finishes (first load, poll or manual refresh).
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [prevStale, setPrevStale] = useState(false);
  // Adjust state while rendering (React's documented alternative to an effect): a refetch just finished, or data first arrived.
  if (query.stale !== prevStale) {
    setPrevStale(query.stale);
    if (prevStale) setRefreshedAt(clock());
  } else if (query.data !== undefined && refreshedAt === null) {
    setRefreshedAt(clock());
  }

  return (
    <PanelErrorBoundary>
      <Stack gap="xs">
        <QueryBoundary query={query} isEmpty={(d) => d.sources.length === 0 && d.queues.length === 0} empty={<EmptyState title="No pipeline data reported yet" />}>
          {(d) => (
            <Stack gap="sm">
              {d.notes?.filter((n) => n !== 'no queues configured').length ? <Text size="xs" c="dimmed" aria-label="Notes from the service">{d.notes.filter((n) => n !== 'no queues configured').join(' ')}</Text> : null}
              <Panel
                dense title="Sources"
                action={(
                  <Group gap="sm" wrap="nowrap">
                    <Text size="xs" c="dimmed" data-testid="health-freshness">
                      {query.stale ? 'Refreshing' : refreshedAt ? `Updated ${formatTime(new Date(refreshedAt).toISOString())}` : ''}
                    </Text>
                    <Button size="compact-xs" variant="default" onClick={() => void query.refresh()} loading={query.stale}>Refresh now</Button>
                  </Group>
                )}
              >
                {d.sources.length ? <SourcesTable sources={d.sources} /> : <Text size="sm" c="dimmed">No sources reported.</Text>}
              </Panel>
              <Panel dense title="Queues">
                {d.queues.length ? <QueuesTable queues={d.queues} /> : <Text size="sm" c="dimmed">No queues reported.{d.notes?.includes('no queues configured') ? ' None are configured for this service.' : ''}</Text>}
              </Panel>
              <Panel dense title="Quarantine">
                <QuarantineSection count={d.quarantine_count} olderCount={d.quarantine_older_count} />
              </Panel>
            </Stack>
          )}
        </QueryBoundary>
      </Stack>
    </PanelErrorBoundary>
  );
};
export default HealthTab;

const NO_EXPECTATION = 'No freshness expectation configured for this source. Set SIEM_SOURCE_EXPECTATIONS.';
const NOT_MEASURABLE = 'Freshness cannot be evaluated for this source from the rollups.';

/** null means freshness is not evaluated: that is UNMEASURED, never OK. The reason is said in one short line. */
const SourceStatus = ({ stale, reason }: { stale: boolean | null | undefined; reason?: HealthSource['stale_reason'] }) =>
  stale === true ? <Badge color="red" variant="filled" title="No events within the expected interval">STALE</Badge>
  : stale === false ? <Badge color="green" variant="light" title="Events arrived within the expected interval">OK</Badge>
  : (
    <Group gap={8} wrap="nowrap">
      <Badge color="gray" variant="outline" style={{ flexShrink: 0 }}>UNMEASURED</Badge>
      <Text size="xs" c="dimmed" data-testid="unmeasured-reason" style={{ whiteSpace: 'normal' }}>{reason === 'not_measurable' ? NOT_MEASURABLE : NO_EXPECTATION}</Text>
    </Group>
  );

const Count = ({ n }: { n: number | null | undefined }) => (n === null || n === undefined ? <Unmeasured /> : <Text size="sm">{formatNumber(n)}</Text>);

export const SourcesTable = ({ sources }: { sources: HealthSource[] }) => {
  const columns = useMemo<MRT_ColumnDef<HealthSource>[]>(() => [
    { accessorKey: 'source', header: 'Source', size: 90, Cell: ({ row }) => <Text size="sm" ff="monospace">{row.original.source}</Text> },
    { id: 'status', header: 'Status', size: 440, accessorFn: (r) => r.stale, Cell: ({ row }) => <SourceStatus stale={row.original.stale} reason={row.original.stale_reason} /> },
    { id: 'last', header: 'Last event', size: 230, accessorFn: (r) => r.last_event_at,
      Cell: ({ row }) => row.original.last_event_at
        ? <Text size="sm">{relativeTime(row.original.last_event_at)} <Text span size="xs" c="dimmed">({formatTime(row.original.last_event_at)})</Text></Text>
        : <Unmeasured reason="No event has been recorded for this source." /> },
    { id: 'h1', header: 'Events (1h)', size: 90, accessorFn: (r) => r.events_1h, Cell: ({ row }) => <Count n={row.original.events_1h} /> },
    { id: 'h24', header: 'Events (24h)', size: 90, accessorFn: (r) => r.events_24h, Cell: ({ row }) => <Count n={row.original.events_24h} /> },
  ], []);
  return <HealthTable label="Sources" columns={columns} data={sources} rowProps={(r) => ({ 'data-stale': String(r.original.stale) })} />;
};

const ROLE_LABEL: Record<HealthQueue['role'], string> = { ingest: 'Ingest', cleanup: 'Cleanup', failures: 'Failures', other: 'Other' };
const isFailing = (q: HealthQueue): boolean => q.role === 'failures' && (q.depth ?? 0) > 0;

const Num = ({ n, digits = 0 }: { n: number | null | undefined; digits?: number }) =>
  n === null || n === undefined ? <Unmeasured /> : <Text size="sm">{digits ? n.toFixed(digits) : formatNumber(n)}</Text>;

export const QueuesTable = ({ queues }: { queues: HealthQueue[] }) => {
  const failing = queues.filter(isFailing);
  const columns = useMemo<MRT_ColumnDef<HealthQueue>[]>(() => [
    { id: 'name', header: 'Queue', accessorFn: (r) => r.name,
      Cell: ({ row }) => (
        <Text size="sm" ff="monospace">
          {row.original.name} {isFailing(row.original) ? <Badge color="red" variant="filled" ml={4}>FAILING</Badge> : null}
        </Text>
      ) },
    { id: 'role', header: 'Role', accessorFn: (r) => ROLE_LABEL[r.role] },
    { id: 'depth', header: 'Depth', accessorFn: (r) => r.depth, Cell: ({ row }) => <Num n={row.original.depth} /> },
    { id: 'consumers', header: 'Consumers', accessorFn: (r) => r.consumers, Cell: ({ row }) => <Num n={row.original.consumers} /> },
    { id: 'enq', header: 'Enqueued / min', accessorFn: (r) => r.enqueued_per_min, Cell: ({ row }) => <Num n={row.original.enqueued_per_min} digits={1} /> },
    { id: 'deq', header: 'Dequeued / min', accessorFn: (r) => r.dequeued_per_min, Cell: ({ row }) => <Num n={row.original.dequeued_per_min} digits={1} /> },
  ], []);
  return (
    <Stack gap="xs">
      {failing.map((q) => (
        <Alert key={q.name} color="red" title="Messages are failing" role="alert">
          <Text size="sm">
            The failures queue <Text span ff="monospace">{q.name}</Text> holds {formatNumber(q.depth)} {q.depth === 1 ? 'message' : 'messages'}. These are events the pipeline
            could not process. They are not lost, but nothing will read them until an operator investigates.
          </Text>
        </Alert>
      ))}
      <HealthTable
        label="Queues" columns={columns} data={queues}
        rowProps={(r) => (isFailing(r.original) ? { 'data-failing': 'true', style: { backgroundColor: 'var(--mantine-color-red-light)', outline: '2px solid var(--mantine-color-red-6)' } } : {})}
      />
    </Stack>
  );
};

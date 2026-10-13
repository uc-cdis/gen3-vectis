import React, { useMemo, useState } from 'react';
import { ActionIcon, Anchor, Button, Group, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconRefresh } from '@tabler/icons-react';
import { EmptyTableMessage } from '@gen3/frontend';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table-open';
import type { Run, RunState } from '@/lib/jobs/model';
import { JobsApiError } from '@/lib/jobs/api';
import { useJobsApi, useJobsQuery } from '@/lib/jobs/api/hooks';
import Time from '@/lib/vectis-kit/ui/Time';
import { LoadingState } from '@/lib/vectis-kit/ui/primitives';
import { formatDuration } from '@/lib/vectis-kit/ui/format';
import { ErrorState, StateBadge } from './common';
import type { PollPhase } from './model';
import { RUNS_POLL, RUN_STATES, STATE_META, anyActive } from './model';

/** One page is loaded; older runs only when the user asks for them. */
const PAGE_SIZE = 50;
const Dash = () => <Text span size="sm" c="dimmed">—</Text>;

const STATE_OPTIONS = RUN_STATES.filter((s) => s !== 'unknown').map((s) => ({ value: s, label: STATE_META[s].label }));

const ServiceLine = () => {
  const q = useJobsQuery('service-info', [], (a) => a.serviceInfo());
  const name = q.data?.name ?? null;
  const version = q.data?.version ?? null;
  if (!name && !version) return null; // never blocks the page
  return <Text size="xs" c="dimmed" data-testid="service-line">Service: {[name, version].filter(Boolean).join(' ')}</Text>;
};

const RunsTab = ({ onOpen, schedule = RUNS_POLL }: { onOpen: (id: string) => void; schedule?: readonly PollPhase[] }) => {
  const api = useJobsApi();
  const [state, setState] = useState<RunState | null>(null);
  const [prefix, setPrefix] = useState('');
  const [debounced] = useDebouncedValue(prefix.trim(), 300);
  // Older pages are fetched only by the "Load older" button, once per click, and are never refreshed.
  // They belong to the filter they were fetched under; a different filter ignores them (no reset effect needed).
  const filterKey = `${state ?? ''}|${debounced}`;
  const [olderFetched, setOlder] = useState<{ key: string; runs: Run[]; next: string | null } | null>(null);
  const [olderErrorFetched, setOlderError] = useState<{ key: string; error: JobsApiError } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const older = olderFetched?.key === filterKey ? olderFetched : null;
  const olderError = olderErrorFetched?.key === filterKey ? olderErrorFetched.error : null;

  const q = useJobsQuery(
    'runs', [state, debounced],
    (a) => a.listRuns({ detail: 'summary', state: state ?? undefined, name_prefix: debounced || undefined, page_size: PAGE_SIZE }),
    { poll: { phases: schedule, active: (d) => anyActive(d?.runs) } }, // only the current (first) page, only while something on it can change
  );
  const firstPage = useMemo(() => q.data?.runs ?? [], [q.data]);
  const runs = useMemo(() => {
    const seen = new Set(firstPage.map((t) => t.id));
    return [...firstPage, ...(older?.runs ?? []).filter((t) => !seen.has(t.id))];
  }, [firstPage, older]);
  const nextToken = older ? older.next : q.data?.next_page_token ?? null;
  const polling = anyActive(q.data?.runs) && !q.paused;

  const loadOlder = async () => {
    if (!nextToken || loadingOlder) return;
    setLoadingOlder(true); setOlderError(null);
    const key = filterKey;
    try {
      const page = await api.listRuns({ detail: 'summary', state: state ?? undefined, name_prefix: debounced || undefined, page_size: PAGE_SIZE, page_token: nextToken });
      setOlder((o) => ({ key, runs: [...(o?.key === key ? o.runs : []), ...page.runs], next: page.next_page_token }));
    } catch (e) {
      setOlderError({ key, error: e instanceof JobsApiError ? e : new JobsApiError(0, 'The jobs service could not be reached.') });
    } finally { setLoadingOlder(false); }
  };

  const columns = useMemo<MRT_ColumnDef<Run>[]>(() => [
    { id: 'name', header: 'Name', accessorFn: (t) => t.name,
      Cell: ({ row }) => (
        <Anchor component="button" type="button" size="sm" fw={600} ta="left" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onOpen(row.original.id); }} aria-label={`Open run ${row.original.name || row.original.id}`}>
          {row.original.name || row.original.id}
        </Anchor>
      ) },
    { id: 'state', header: 'State', accessorFn: (t) => t.state, Cell: ({ row }) => <StateBadge run={row.original} /> },
    { id: 'job', header: 'Job', accessorFn: (t) => t.job, Cell: ({ row }) => (row.original.job ? <Text size="sm" ff="monospace">{row.original.job}</Text> : <Dash />) },
    { id: 'by', header: 'Submitted by', accessorFn: (t) => t.submitted_by, Cell: ({ row }) => (row.original.submitted_by ? <Text size="sm">{row.original.submitted_by}</Text> : <Dash />) },
    { id: 'created', header: 'Created', accessorFn: (t) => t.created_at, Cell: ({ row }) => <Time iso={row.original.created_at} /> },
    { id: 'duration', header: 'Duration', accessorFn: (t) => formatDuration(t.started_at, t.ended_at), Cell: ({ row }) => <Text size="sm">{formatDuration(row.original.started_at, row.original.ended_at)}</Text> },
  ], [onOpen]);

  const table = useMantineReactTable<Run>({
    columns, data: runs,
    enableSorting: false, enableColumnActions: false, enableColumnFilters: false, enableGlobalFilter: false, enableDensityToggle: false,
    enableFullScreenToggle: false, enableHiding: false, enableTopToolbar: false, enableBottomToolbar: false, enablePagination: false,
    renderEmptyRowsFallback: () => <EmptyTableMessage message={state || debounced ? 'No runs match these filters' : 'No runs yet. Run a job from the Catalog tab.'} />,
    mantineTableProps: { highlightOnHover: true, striped: true, 'aria-label': 'Runs' },
    mantineTableBodyRowProps: ({ row }) => ({ onClick: () => onOpen(row.original.id), style: { cursor: 'pointer' }, 'data-state': row.original.state }),
  });

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end">
        <Group align="flex-end" gap="sm">
          <Select label="State" placeholder="All states" data={STATE_OPTIONS} value={state} onChange={(v) => setState((v as RunState | null) ?? null)} clearable w={190} size="sm" />
          <TextInput label="Name starts with" placeholder="Run name" value={prefix} onChange={(e) => setPrefix(e.currentTarget.value)} maxLength={128} w={240} size="sm" />
        </Group>
        <Stack gap={2} align="flex-end">
          <Group gap="xs">
            <Text size="xs" c={q.paused ? 'orange.8' : 'dimmed'} role="status" data-testid="refresh-note">
              {q.paused ? 'Paused: refresh to resume' : q.stale ? 'Updating…' : q.updatedAt ? `Last updated ${new Date(q.updatedAt).toLocaleTimeString('en-US')}` : ''}
              {polling && !q.stale ? ' · refreshing automatically while runs are active' : ''}
            </Text>
            <Tooltip label="Refresh now" withArrow>
              <ActionIcon variant="default" aria-label="Refresh runs" onClick={() => void q.refresh()}><IconRefresh size={16} /></ActionIcon>
            </Tooltip>
          </Group>
          <ServiceLine />
        </Stack>
      </Group>
      {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refresh()} /> : !q.data ? <LoadingState rows={5} /> : (
        <>
          {q.error ? <ErrorState error={q.error} onRetry={() => void q.refresh()} /> : null}
          <MantineReactTable table={table} />
          {olderError ? <ErrorState error={olderError} onRetry={() => void loadOlder()} /> : null}
          <Group justify="space-between">
            <Text size="xs" c="dimmed">{runs.length} {runs.length === 1 ? 'run' : 'runs'} shown</Text>
            {nextToken ? <Button size="xs" variant="default" onClick={() => void loadOlder()} loading={loadingOlder}>Load older</Button> : <Text size="xs" c="dimmed">{runs.length ? 'No older runs' : ''}</Text>}
          </Group>
        </>
      )}
    </Stack>
  );
};

export default RunsTab;

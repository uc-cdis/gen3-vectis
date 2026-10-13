import React, { useMemo, useState } from 'react';
import { Badge, Button, Code, Drawer, Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { QuarantineGroup, QuarantineRecord } from '@/lib/vectis-kit/spec';
import { formatNumber, formatTime, relativeTime } from '@/lib/vectis-kit/ui/format';
import { CopyIcon, QueryBoundary, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { HealthTable } from './HealthTable';

/** How far back "recent" reaches. The service applies the same default; it is sent explicitly so the two cannot drift silently. */
export const QUARANTINE_WINDOW_HOURS = 36;
/** Records are listed a few at a time: a group is a summary, the list is the detail. */
const RECORDS_PAGE_SIZE = 10;

/** Read only on purpose. Replaying a quarantined object is a deliberate operator action done outside this console. */
const RecordDetail = ({ rec, onClose }: { rec: QuarantineRecord | null; onClose: () => void }) => (
  <Drawer opened={rec !== null} onClose={onClose} position="right" title="Quarantined record" transitionProps={{ duration: 0 }}>
    {rec ? (
      <Stack gap="sm">
        <Text size="sm" c="dimmed">This panel is read only. Replaying a quarantined object is a deliberate operator action done outside this console.</Text>
        <div>
          <Text size="xs" c="dimmed">Raw key</Text>
          {rec.raw_key ? (
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <Code data-testid="detail-raw-key" style={{ overflowWrap: 'anywhere' }}>{rec.raw_key}</Code>
              <CopyIcon value={rec.raw_key} what="raw key" />
            </Group>
          ) : <Unmeasured reason="No raw key was recorded." />}
        </div>
        <div><Text size="xs" c="dimmed">Source</Text>{rec.source ? <Text size="sm">{rec.source}</Text> : <Unmeasured reason="No source was recorded." />}</div>
        <div><Text size="xs" c="dimmed">Reason</Text><Text size="sm" style={{ overflowWrap: 'anywhere' }}>{rec.reason}</Text></div>
        <div>
          <Text size="xs" c="dimmed">Quarantined</Text>
          {rec.quarantined_at ? <Text size="sm">{formatTime(rec.quarantined_at)} ({relativeTime(rec.quarantined_at)})</Text> : <Unmeasured reason="No time was recorded." />}
        </div>
        <div><Text size="xs" c="dimmed">Record key</Text><Code>{rec.key}</Code></div>
      </Stack>
    ) : null}
  </Drawer>
);


const RecordsPage = ({ reason, older, onSelect }: { reason: string; older: boolean; onSelect: (r: QuarantineRecord) => void }) => {
  const [offset, setOffset] = useState(0);
  const query = useSiemQuery('quarantine', { body: { window_hours: QUARANTINE_WINDOW_HOURS, older, reason, paging: { limit: RECORDS_PAGE_SIZE, offset } } });
  const columns = useMemo<MRT_ColumnDef<QuarantineRecord>[]>(() => [
    { id: 'raw', header: 'Raw key', accessorFn: (r) => r.raw_key, Cell: ({ row }) => row.original.raw_key ? <Text size="xs" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{row.original.raw_key}</Text> : <Unmeasured /> },
    { id: 'source', header: 'Source', size: 80, accessorFn: (r) => r.source, Cell: ({ row }) => row.original.source ? <Text size="xs">{row.original.source}</Text> : <Unmeasured /> },
    { id: 'at', header: 'Quarantined', size: 110, accessorFn: (r) => r.quarantined_at, Cell: ({ row }) => row.original.quarantined_at ? <Text size="xs" title={formatTime(row.original.quarantined_at)}>{relativeTime(row.original.quarantined_at)}</Text> : <Unmeasured /> },
    { id: 'act', header: '', size: 90, Cell: ({ row }) => <Button size="compact-xs" variant="default" aria-label={`Investigate ${row.original.key}`} onClick={() => onSelect(row.original)}>Investigate</Button> },
  ], [onSelect]);
  return (
    <QueryBoundary query={query} rows={2}>
      {(d) => (
        <Stack gap="xs" mt="xs">
          <HealthTable label="Quarantined records" columns={columns} data={d.records} />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Showing {formatNumber(d.records.length ? offset + 1 : 0)} to {formatNumber(offset + d.records.length)} of {formatNumber(d.total)}{d.truncated ? ' or more' : ''}</Text>
            <Group gap="xs">
              <Button size="compact-xs" variant="default" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - RECORDS_PAGE_SIZE))}>Previous page</Button>
              <Button size="compact-xs" variant="default" disabled={offset + d.records.length >= d.total} onClick={() => setOffset(offset + RECORDS_PAGE_SIZE)}>Next page</Button>
            </Group>
          </Group>
        </Stack>
      )}
    </QueryBoundary>
  );
};

const Span = ({ g }: { g: QuarantineGroup }) => {
  const first = g.first_seen, last = g.last_seen;
  if (!first || !last) return <Unmeasured reason="No time was recorded for these records." />;
  return (
    <Text size="xs" c="dimmed" title={`${formatTime(first)} to ${formatTime(last)}`}>
      {first === last || relativeTime(first) === relativeTime(last) ? `seen ${relativeTime(last)}` : `first ${relativeTime(first)}, last ${relativeTime(last)}`}
    </Text>
  );
};

const GroupCard = ({ g, older, onSelect }: { g: QuarantineGroup; older: boolean; onSelect: (r: QuarantineRecord) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <Paper withBorder p="sm" radius="md" data-testid="quarantine-group">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{g.hint}</Text>
          <Text size="xs" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere' }} lineClamp={2} title={g.reason}>{g.reason}</Text>
          <Group gap="sm"><Span g={g} />{g.sample_key ? <Text size="xs" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere' }}>e.g. {g.sample_key}</Text> : null}</Group>
        </Stack>
        <Stack gap={4} align="flex-end" style={{ flexShrink: 0 }}>
          <Badge color={older ? 'gray' : 'orange'} variant="light" radius="sm" aria-label={`${g.count} records`}>{formatNumber(g.count)} {g.count === 1 ? 'record' : 'records'}</Badge>
          <Button size="compact-xs" variant="subtle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide records' : 'Show records'}</Button>
        </Stack>
      </Group>
      {open ? <RecordsPage reason={g.reason} older={older} onSelect={onSelect} /> : null}
    </Paper>
  );
};

const GroupList = ({ older, onSelect }: { older: boolean; onSelect: (r: QuarantineRecord) => void }) => {
  const query = useSiemQuery('quarantine', { body: { window_hours: QUARANTINE_WINDOW_HOURS, older, paging: { limit: 1 } } });
  return (
    <QueryBoundary query={query} rows={2}>
      {(d) => (
        <Stack gap="xs" aria-label={older ? 'Older quarantine groups' : 'Quarantine groups'}>
          {(d.groups ?? []).length === 0 ? <Text size="sm" c="dimmed">No records.</Text> : null}
          {(d.groups ?? []).map((g) => <GroupCard key={g.reason} g={g} older={older} onSelect={onSelect} />)}
          {d.truncated ? <Text size="xs" c="yellow.9">Only the newest records were read, so these counts are a lower bound.</Text> : null}
        </Stack>
      )}
    </QueryBoundary>
  );
};

/**
 * The quarantine, summarised: nothing recent is a calm one-liner; recent records are grouped by reason, each group's records
 * collapsed behind "Show records". Older records are fetched only when asked for. Read only: replaying is an operator action.
 */
export const QuarantineSection = ({ count, olderCount }: { count: number | null | undefined; olderCount: number | null | undefined }) => {
  const [showOlder, setShowOlder] = useState(false);
  const [selected, setSelected] = useState<QuarantineRecord | null>(null);
  const hours = QUARANTINE_WINDOW_HOURS;
  const olderLabel = olderCount === null || olderCount === undefined ? 'Show older records (count unknown)' : `Show older records (${formatNumber(olderCount)})`;
  return (
    <Stack gap="sm" data-testid="quarantine-summary">
      {count === null || count === undefined ? (
        <Group gap="xs"><Text size="sm">Quarantined records, last {hours} hours:</Text><Unmeasured reason="The quarantine could not be read. This is not zero." /></Group>
      ) : count === 0 ? (
        <Group gap="xs" wrap="nowrap" data-testid="quarantine-clear">
          <ThemeIcon color="green" variant="light" radius="xl" size="sm" aria-hidden><IconCheck size={14} /></ThemeIcon>
          <Text size="sm">No quarantined records in the last {hours} hours</Text>
        </Group>
      ) : (
        <Group gap="xs"><Badge color="orange" variant="light" radius="sm" data-testid="quarantine-count">{formatNumber(count)}</Badge><Text size="sm">{count === 1 ? 'record' : 'records'} quarantined in the last {hours} hours, grouped by reason</Text></Group>
      )}
      {count ? <GroupList older={false} onSelect={setSelected} /> : null}
      {olderCount === 0 ? null : (
        <div>
          <Button size="compact-sm" variant="subtle" aria-expanded={showOlder} onClick={() => setShowOlder((o) => !o)}>{showOlder ? 'Hide older records' : olderLabel}</Button>
        </div>
      )}
      {showOlder ? (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">Older than {hours} hours. These are usually failures that have since been fixed or replayed.</Text>
          <GroupList older onSelect={setSelected} />
        </Stack>
      ) : null}
      <RecordDetail rec={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
};

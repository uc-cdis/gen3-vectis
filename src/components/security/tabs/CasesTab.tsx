import React, { useMemo, useState } from 'react';
import { Anchor, Badge, Button, Chip, Group, Stack, Text, Title } from '@mantine/core';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import { MantineReactTable, useMantineReactTable } from 'mantine-react-table-open';
import { PanelErrorBoundary } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { CaseRecord } from '@/lib/vectis-kit/spec';
import { formatTime, relativeTime } from '@/lib/vectis-kit/ui/format';
import { EmptyState, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { useSecurity } from '../context';
import { CASE_STATUS_COLOR, CASE_STATUS_LABEL, DEFAULT_VISIBLE_STATUSES, PRIORITY_COLOR, PRIORITY_LABEL, STATUSES, filterCasesByStatus, priorityRank, sortCasesByPriority } from '../cases/caseModel';
import type { CaseStatus } from '../cases/caseModel';
import { CaseFile } from '../cases/CaseFile';
import { CreateCaseModal } from '../cases/CreateCaseModal';

const CaseTable = ({ cases, onOpen }: { cases: CaseRecord[]; onOpen: (id: string) => void }) => {
  const columns = useMemo<MRT_ColumnDef<CaseRecord>[]>(() => [
    {
      accessorKey: 'title', header: 'Case', size: 320,
      Cell: ({ row }) => (
        <Anchor component="button" type="button" size="sm" ta="left" onClick={() => onOpen(row.original.case_id)} aria-label={`Open case ${row.original.title}`}>
          {row.original.title}
        </Anchor>
      ),
    },
    { id: 'status', header: 'Status', accessorFn: (r) => CASE_STATUS_LABEL[r.status],
      Cell: ({ row }) => <Badge color={CASE_STATUS_COLOR[row.original.status]} variant="light">{CASE_STATUS_LABEL[row.original.status]}</Badge> },
    // sorted by rank, never alphabetically
    { id: 'priority', header: 'Priority', accessorFn: (r) => priorityRank(r.priority), sortUndefined: 'last',
      Cell: ({ row }) => <Badge color={PRIORITY_COLOR[row.original.priority]} variant="filled">{PRIORITY_LABEL[row.original.priority]}</Badge> },
    { id: 'assignee', header: 'Assignee', accessorFn: (r) => r.assignee ?? '',
      Cell: ({ row }) => <Text size="sm" c={row.original.assignee ? undefined : 'dimmed'}>{row.original.assignee ?? 'Unassigned'}</Text> },
    { id: 'alerts', header: 'Alerts', accessorFn: (r) => r.group_ids.length },
    { id: 'updated', header: 'Updated', accessorFn: (r) => r.updated_at,
      Cell: ({ row }) => <Text size="sm" title={formatTime(row.original.updated_at)}>{relativeTime(row.original.updated_at)}</Text> },
  ], [onOpen]);

  const data = useMemo(() => sortCasesByPriority(cases), [cases]);
  const table = useMantineReactTable({
    columns, data,
    enableColumnActions: false, enableColumnFilters: false, enableGlobalFilter: false, enableDensityToggle: false, enableFullScreenToggle: false,
    enableHiding: false, enableTopToolbar: false, enableMultiSort: false,
    initialState: { sorting: [{ id: 'priority', desc: true }], pagination: { pageIndex: 0, pageSize: 25 } },
    getRowId: (r) => r.case_id,
    mantineTableProps: { 'aria-label': 'Cases' },
  });
  return <MantineReactTable table={table} />;
};

/** The case list with a status filter; closed is off by default. */
const FilteredCases = ({ cases, onOpen }: { cases: CaseRecord[]; onOpen: (id: string) => void }) => {
  const [visible, setVisible] = useState<CaseStatus[]>([...DEFAULT_VISIBLE_STATUSES]);
  const shown = useMemo(() => filterCasesByStatus(cases, visible), [cases, visible]);
  const count = (s: CaseStatus) => cases.filter((c) => c.status === s).length;
  return (
    <Stack gap="sm">
      <Group gap="xs" role="group" aria-label="Filter cases by status">
        <Text size="sm" c="dimmed">Show</Text>
        <Chip.Group multiple value={visible} onChange={(v) => setVisible(v as CaseStatus[])}>
          {STATUSES.map((s) => <Chip key={s} value={s} size="xs">{`${CASE_STATUS_LABEL[s]} (${count(s)})`}</Chip>)}
        </Chip.Group>
      </Group>
      {shown.length === 0 ? (
        <EmptyState title="No cases match the filter" hint="Switch on another status above, for example Closed, to see older cases." />
      ) : (
        <CaseTable cases={shown} onOpen={onOpen} />
      )}
    </Stack>
  );
};

const CasesTab = () => {
  const query = useSiemQuery('cases', {});
  // The open case lives in the URL (?case=) so a case is deep-linkable and the entity drawer can link to it.
  const { caseId: openId, openCase: setOpenId } = useSecurity();
  const [creating, setCreating] = useState(false);

  return (
    <PanelErrorBoundary>
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={3}>Cases</Title>
          {openId ? null : <Button onClick={() => setCreating(true)}>Create case</Button>}
        </Group>
        {openId ? (
          <CaseFile caseId={openId} onClose={() => setOpenId(null)} />
        ) : (
          <QueryBoundary
            query={query}
            isEmpty={(d) => d.cases.length === 0}
            empty={<EmptyState title="No cases yet" hint="Create one, or open an alert and add it to a case." />}
          >
            {(d) => <FilteredCases cases={d.cases} onOpen={setOpenId} />}
          </QueryBoundary>
        )}
        <CreateCaseModal opened={creating} onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); setOpenId(c.case_id); }} />
      </Stack>
    </PanelErrorBoundary>
  );
};
export default CasesTab;

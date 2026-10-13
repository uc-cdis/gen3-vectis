import React, { useCallback, useMemo, useState } from 'react';
import type { MRT_PaginationState, MRT_RowSelectionState } from 'mantine-react-table-open';
import { Button, Group, List, Modal, Stack, Text } from '@mantine/core';
import { useRouter } from 'next/router';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { AlertsRequest } from '@/lib/vectis-kit/spec';
import { useSecurity } from '../context';
import { EmptyState, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import AlertsTable from '../alerts/AlertsTable';
import AlertsToolbar, { DEFAULT_FILTERS } from '../alerts/AlertsToolbar';
import type { AlertFilters } from '../alerts/AlertsToolbar';
import BulkBar from '../alerts/BulkBar';
import { SHORTCUTS, useAlertShortcuts } from '../alerts/useAlertShortcuts';

const FIRST_PAGE: MRT_PaginationState = { pageIndex: 0, pageSize: 50 };

function buildRequest(f: AlertFilters, window: AlertsRequest['window'], p: MRT_PaginationState, withFloor: boolean): AlertsRequest {
  return {
    window,
    min_severity: withFloor && !f.showLowInfo ? f.floor : null,
    sort: f.sort,
    include_noise: f.includeNoise,
    detector_tiers: f.tier ? [f.tier as NonNullable<AlertsRequest['detector_tiers']>[number]] : [],
    statuses: f.status ? [f.status as NonNullable<AlertsRequest['statuses']>[number]] : [],
    paging: { limit: p.pageSize, offset: p.pageIndex * p.pageSize },
  };
}

const STATUSES = ['new', 'triaged', 'investigating', 'resolved'];
const FLOORS = ['critical', 'high', 'medium', 'low', 'info'];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export function filtersFromQuery(q: Record<string, string | string[] | undefined>): AlertFilters {
  const status = one(q.status);
  const floor = one(q.floor);
  return {
    ...DEFAULT_FILTERS,
    status: status && STATUSES.includes(status) ? status : '',
    floor: floor && FLOORS.includes(floor) ? (floor as AlertFilters['floor']) : DEFAULT_FILTERS.floor,
    showLowInfo: one(q.all) === '1',
  };
}

const AlertsTab = () => {
  const { window, alertId, openAlert } = useSecurity();
  // Links from the Overview arrive with ?status= / ?floor= / ?all=1, so "12 waiting" opens exactly those 12.
  const router = useRouter();
  const [filters, setFilters] = useState<AlertFilters>(() => filtersFromQuery(router.query));
  const [pagination, setPagination] = useState<MRT_PaginationState>(FIRST_PAGE);
  const [selection, setSelection] = useState<MRT_RowSelectionState>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const query = useSiemQuery('alerts', { body: buildRequest(filters, window, pagination, true) });
  // Same filters without the floor, one row: only its total is used, to say how many the floor hides.
  const unfloored = useSiemQuery('alerts', { body: buildRequest(filters, window, { pageIndex: 0, pageSize: 1 }, false) });

  const groups = query.data?.groups;
  const ids = useMemo(() => (groups ?? []).map((g) => g.group_id), [groups]);
  const selectedIds = useMemo(() => Object.keys(selection).filter((k) => selection[k]), [selection]);

  const changeFilters = (next: AlertFilters) => { setFilters(next); setPagination((p) => ({ ...p, pageIndex: 0 })); setSelection({}); setActiveId(null); };

  const move = useCallback((delta: 1 | -1) => {
    if (!ids.length) return;
    const i = activeId ? ids.indexOf(activeId) : -1;
    const next = i === -1 ? (delta === 1 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + delta));
    setActiveId(ids[next] ?? null);
    document.querySelector(`[data-active="true"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [ids, activeId]);

  useAlertShortcuts({
    enabled: alertId === null,
    move,
    open: () => { if (activeId) openAlert(activeId); },
    toggleSelect: () => { if (activeId) setSelection((s) => { const n = { ...s }; if (n[activeId]) delete n[activeId]; else n[activeId] = true; return n; }); },
    help: () => setHelpOpen(true),
  });

  const total = query.data?.total;
  const hidden = !filters.showLowInfo && total !== undefined && unfloored.data ? Math.max(0, unfloored.data.total - total) : null;
  const summary = query.data ? (
    <>
      {query.data.total.toLocaleString('en-US')} alert group{query.data.total === 1 ? '' : 's'}
      {query.data.truncated ? ` (truncated, showing ${query.data.groups.length} on this page; use the pager for the rest)` : ''}
      {filters.showLowInfo ? '. Showing every severity.' : hidden === null ? '' : hidden > 0 ? `. ${hidden.toLocaleString('en-US')} more below the ${filters.floor} floor are hidden.` : '. Nothing is hidden by the severity floor.'}
    </>
  ) : 'Loading alerts';

  return (
    <Stack gap="sm">
      <AlertsToolbar value={filters} onChange={changeFilters} summary={summary} />
      <BulkBar ids={selectedIds} onClear={() => setSelection({})} />
      <QueryBoundary
        query={query}
        isEmpty={(d) => d.groups.length === 0}
        empty={<EmptyState title="No alerts match" hint={filters.showLowInfo ? 'Widen the time range or clear the filters.' : 'Lower the severity floor, widen the time range, or clear the filters.'} />}
        rows={6}
      >
        {(d) => (
          <AlertsTable
            groups={d.groups}
            total={d.total}
            pagination={pagination}
            onPaginationChange={(p) => { setPagination(p); setActiveId(null); }}
            rowSelection={selection}
            onRowSelectionChange={setSelection}
            activeId={activeId}
            onOpen={openAlert}
            busy={query.stale}
          />
        )}
      </QueryBoundary>
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Data as of {query.data ? new Date(query.data.as_of).toLocaleString('en-US') : '…'}</Text>
        <Button size="compact-xs" variant="subtle" onClick={() => setHelpOpen(true)} aria-label="Show keyboard shortcuts">Shortcuts (?)</Button>
      </Group>
      <Modal opened={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <List spacing="xs" listStyleType="none">
          {SHORTCUTS.map((s) => <List.Item key={s.keys}><kbd>{s.keys}</kbd> {s.does}</List.Item>)}
        </List>
        <Text size="xs" c="dimmed" mt="sm">Shortcuts are off while you type in a field or while a panel is open.</Text>
      </Modal>
    </Stack>
  );
};
export default AlertsTab;

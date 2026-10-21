import React, { useMemo, useEffect, useRef } from 'react';
import { SimpleGrid, Stack, Anchor, Badge, Group, Text, Paper, UnstyledButton, Table } from '@mantine/core';
import { PanelErrorBoundary, ReactECharts } from '@gen3/frontend';
import type { ReactEChartsProps } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { QueryState } from '@/lib/vectis-kit/api/hooks';
import { useSecurity } from '../context';
import type { TabId, RangeId } from '../context';
import { LoadingState, EmptyState, Panel, QueryBoundary, Unmeasured, SeverityBadge, EntityLink } from '@/lib/vectis-kit/ui/primitives';
import { severityRank } from '@/lib/vectis-kit/spec';
import type { CaseRecord, AlertGroup, TimeWindow, Bucket } from '@/lib/vectis-kit/spec';
import { formatNumber, relativeTime, formatPercent } from '@/lib/vectis-kit/ui/format';
import type { OverviewTotals } from '@/lib/vectis-kit/spec/generated/contract.generated';
import { isIpAddress } from '@/lib/vectis-kit/spec/indicator';
import { RollupChart } from '@/lib/vectis-kit/timeseries/RollupChart';
import type { Grain } from '@/lib/vectis-kit/timeseries/rollupOption';
import { neutraliseBraces } from '@/lib/safe-text';

const OverviewTab = () => {
  const { window } = useSecurity();
  const overview = useSiemQuery('overview', { body: { window, top_n: 10 } });
  return (
    <Stack gap="md" data-testid="overview-tab">
      <PanelErrorBoundary><NeedsYouStrip /></PanelErrorBoundary>
      <PanelErrorBoundary><KpiTiles query={overview} /></PanelErrorBoundary>
      <PanelErrorBoundary><TrendPanel window={window} /></PanelErrorBoundary>
      {/* The KPI tiles above own the error state for this query; here we only avoid a second copy of it. */}
      {overview.data ? (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }}>
          <TopList title="Source IPs" buckets={overview.data.topSourceIps} valueLabel="Events" linkAddresses />
          <TopList title="Event sources" buckets={overview.data.topEventSources} valueLabel="Events" linkAddresses />
          <TopList title="Rules" buckets={overview.data.topRules} valueLabel="Events" />
          <TopList title="Countries" buckets={overview.data.topCountries} valueLabel="Events" />
        </SimpleGrid>
      ) : overview.error ? null : <LoadingState rows={3} />}
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <PanelErrorBoundary><TopAlerts window={window} /></PanelErrorBoundary>
        <PanelErrorBoundary><CasesSummary /></PanelErrorBoundary>
      </SimpleGrid>
    </Stack>
  );
};

const PRIORITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;
const PRIORITY_COLOR = { low: 'blue', medium: 'yellow', high: 'orange', critical: 'red' } as const;
const isOpenCase = (c: CaseRecord): boolean => c.status === 'open' || c.status === 'in_progress';

const CasesSummary = () => {
  const { goTab } = useSecurity();
  const q = useSiemQuery('cases', {});
  useRefreshOnKey(q);
  return (
    <Panel title="Open cases" action={<Anchor component="button" type="button" size="xs" onClick={() => goTab('cases')}>All cases</Anchor>}>
      <QueryBoundary query={q} isEmpty={(d) => d.cases.filter(isOpenCase).length === 0} empty={<EmptyState title="No open cases" />} rows={3}>
        {(d) => {
          const open = d.cases.filter(isOpenCase).sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.updated_at.localeCompare(a.updated_at));
          const inProgress = open.filter((c) => c.status === 'in_progress').length;
          return (
            <Stack gap="xs">
              <Text size="sm" data-testid="cases-counts">
                {formatNumber(open.length)} open ({formatNumber(inProgress)} in progress)
                {d.total > d.cases.length ? `, counted among the ${formatNumber(d.cases.length)} newest of ${formatNumber(d.total)} cases` : ''}
              </Text>
              <Stack gap={6} component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
                {open.slice(0, 5).map((c) => (
                  <li key={c.case_id}>
                    <Group gap="xs" wrap="nowrap">
                      <Badge color={PRIORITY_COLOR[c.priority]} variant="filled" radius="sm" size="sm">{c.priority}</Badge>
                      <Anchor component="button" type="button" size="sm" ta="left" onClick={() => goTab('cases')}>{c.title}</Anchor>
                      <Text size="xs" c="dimmed" ml="auto" style={{ whiteSpace: 'nowrap' }}>{c.status === 'in_progress' ? 'in progress' : 'open'}, updated {relativeTime(c.updated_at)}</Text>
                    </Group>
                  </li>
                ))}
              </Stack>
            </Stack>
          );
        }}
      </QueryBoundary>
    </Panel>
  );
};

const NO_DATA = 'No data has been ingested for this source. This is not zero.';
const TILES: { key: keyof OverviewTotals; label: string; hint?: string; unmeasured: string; tab: TabId; opens: string }[] = [
  { key: 'events', label: 'Events, all sources', hint: 'Web, API, sign-in, network and detections', unmeasured: NO_DATA, tab: 'data', opens: 'Data' },
  { key: 'waf', label: 'Web requests', hint: 'WAF, reverse proxy and F5 logs. A request two feeds both log counts twice.', unmeasured: NO_DATA, tab: 'data', opens: 'Data' },
  { key: 'audit', label: 'Audit events', unmeasured: NO_DATA, tab: 'data', opens: 'Data' },
  { key: 'threat', label: 'Indicators loaded', hint: 'Current intel indicators, not windowed', unmeasured: 'The indicator table could not be read. This is not zero.', tab: 'intel', opens: 'Intel' },
  { key: 'ioc_alerts', label: 'Alerts matching indicators', hint: 'Alert groups in this window', unmeasured: 'Alert groups could not be counted. This is not zero.', tab: 'intel', opens: 'Intel' },
  { key: 'telemetry', label: 'Telemetry events', unmeasured: 'No telemetry index exists yet. This is not zero.', tab: 'data', opens: 'Data' },
];

/** Totals for the selected window, from the overview rollup. Telemetry is null until its index exists. */
const KpiTiles = ({ query }: { query: ReturnType<typeof useSiemQuery<'overview'>> }) => {
  const { goTab } = useSecurity();
  return (
    <QueryBoundary query={query} rows={2}>
      {({ totals }) => (
        <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }} component="section" aria-label="Key figures">
          {TILES.map((t) => {
            const v = totals[t.key];
            const measured = v !== null && v !== undefined;
            return (
              <UnstyledButton key={t.key} onClick={() => goTab(t.tab)} aria-label={`${t.label}: ${measured ? formatNumber(v) : 'unmeasured'}. Open ${t.opens}`}>
                <Paper withBorder p="md" radius="md" h="100%">
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed" tt="uppercase">{t.label}</Text>
                    <Text fw={600} fz={28} component="div">{measured ? formatNumber(v) : <Unmeasured reason={t.unmeasured} />}</Text>
                    {t.hint ? <Text size="xs" c="dimmed">{t.hint}</Text> : null}
                  </Stack>
                </Paper>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      )}
    </QueryBoundary>
  );
};

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Stack gap={0} miw={150}>
    <Text size="xs" c="dimmed" tt="uppercase">{label}</Text>
    <Text fw={600} size="xl" component="div">{children}</Text>
  </Stack>
);

/** What needs a human right now. Pickup share and trust floor are null until measured: shown as Unmeasured, never 0. */
const NeedsYouStrip = () => {
  const { goTab } = useSecurity();
  const q = useSiemQuery('triage', { body: {} });
  useRefreshOnKey(q);
  return (
    <Paper withBorder p="md" radius="md" component="section" aria-label="Needs you">
      <Text fw={600} mb="xs">Needs you</Text>
      <QueryBoundary query={q} rows={2}>
        {({ strip, unmeasured_text }) => (
          <Stack gap="xs">
            <Group gap="xl" align="flex-start">
              <Stat label="Waiting">
                {strip.waiting === null || strip.waiting === undefined ? <Unmeasured /> : (
                  <Anchor component="button" type="button" fw={600} fz="xl" onClick={() => goTab('alerts', { status: 'new' })} aria-label={`${strip.waiting} waiting. Open alerts`}>{formatNumber(strip.waiting)}</Anchor>
                )}
              </Stat>
              <Stat label="Cases created today">
                <Anchor component="button" type="button" fw={600} fz="xl" onClick={() => goTab('cases')} aria-label={`${strip.cases_created_today} cases created today. Open cases`}>{formatNumber(strip.cases_created_today)}</Anchor>
              </Stat>
              <Stat label="Picked up">{strip.picked_up_share === null || strip.picked_up_share === undefined ? <Unmeasured /> : formatPercent(strip.picked_up_share)}</Stat>
              <Stat label="Trust floor">{strip.trust_floor === null || strip.trust_floor === undefined ? <Unmeasured /> : formatPercent(strip.trust_floor)}</Stat>
            </Group>
            {unmeasured_text ? <Text size="sm" c="dimmed" data-testid="unmeasured-text">{unmeasured_text}</Text> : null}
          </Stack>
        )}
      </QueryBoundary>
    </Paper>
  );
};

const TOP_ALERTS = 5;
/** Open means not yet resolved and not marked noise. */
const OPEN = ['new', 'triaged', 'investigating'] as const;

const mostSevere = (groups: readonly AlertGroup[], n = TOP_ALERTS): AlertGroup[] =>
  [...groups].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.severity_score - a.severity_score || b.last_seen.localeCompare(a.last_seen)).slice(0, n);

const TopAlerts = ({ window }: { window: TimeWindow }) => {
  const { openAlert, goTab } = useSecurity();
  const q = useSiemQuery('alerts', { body: { window, min_severity: 'high', statuses: [...OPEN], sort: 'severity', paging: { limit: TOP_ALERTS } } });
  return (
    <Panel title="Most severe open alerts" action={<Anchor component="button" type="button" size="xs" onClick={() => goTab('alerts', { floor: 'high' })}>All alerts</Anchor>}>
      <QueryBoundary query={q} isEmpty={(d) => d.groups.length === 0} empty={<EmptyState title="No open high or critical alerts" hint="Nothing at or above high severity is waiting in this window." />} rows={3}>
        {(d) => (
          <Stack gap="xs" component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
            {mostSevere(d.groups).map((g) => (
              <li key={g.group_id}>
                <Group gap="xs" wrap="nowrap" align="center">
                  <SeverityBadge severity={g.severity} />
                  <Anchor component="button" type="button" size="sm" ta="left" onClick={() => openAlert(g.group_id)} title={`Open alert ${g.group_id}`}>{g.title}</Anchor>
                  <Text size="xs" c="dimmed" ml="auto" style={{ whiteSpace: 'nowrap' }}>{formatNumber(g.occurrence_count)} events, {relativeTime(g.last_seen)}</Text>
                </Group>
              </li>
            ))}
            {d.total > TOP_ALERTS ? <Text size="xs" c="dimmed">{formatNumber(d.total - TOP_ALERTS)} more not shown.</Text> : null}
          </Stack>
        )}
      </QueryBoundary>
    </Panel>
  );
};

/**
 * A ranked list as horizontal bars with the same numbers in a table. Values that are addresses render through
 * <EntityLink> (in the table, and by clicking the bar); everything else is plain text.
 */
const TopList = ({ title, buckets, valueLabel, linkAddresses }: { title: string; buckets: readonly Bucket[]; valueLabel: string; linkAddresses?: boolean }) => {
  const { openEntity } = useSecurity();
  const option = useMemo(() => buildBarOption(buckets, valueLabel), [buckets, valueLabel]);
  const alt = useMemo(() => describeBuckets(title, buckets), [title, buckets]);
  const events = useMemo(() => ({
    click: (e: { name?: unknown }) => {
      if (linkAddresses && typeof e.name === 'string' && isIpAddress(e.name)) openEntity({ type: 'ip', value: e.name });
    },
  }), [linkAddresses, openEntity]);
  const shown = [...buckets].sort((a, b) => b.count - a.count);
  return (
    <Panel title={title}>
      {buckets.length === 0 ? <EmptyState title={`No ${title.toLowerCase()} in this window`} /> : (
        <>
          <figure aria-label={alt} style={{ margin: 0 }}>
            <ReactECharts option={option} style={{ height: Math.max(90, 28 * buckets.length + 16), width: '100%' }} events={events} theme="gen3" />
          </figure>
          <details>
            <summary><Text component="span" size="xs">Table</Text></summary>
            <Table withTableBorder aria-label={`${title}, table`}>
              <Table.Thead><Table.Tr><Table.Th>{title}</Table.Th><Table.Th ta="right">{valueLabel}</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {shown.map((b) => (
                  <Table.Tr key={b.key}>
                    <Table.Td>{linkAddresses && isIpAddress(b.key) ? <EntityLink type="ip" value={b.key} /> : b.key}</Table.Td>
                    <Table.Td ta="right">{formatNumber(b.count)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </details>
        </>
      )}
    </Panel>
  );
};

/** Coarser buckets for longer windows keep the point count (and the query) small. */
const GRAIN_FOR_RANGE: Record<RangeId, Grain> = { '1h': '1m', '24h': '5m', '7d': '1h', '30d': '1h' };

const TrendPanel = ({ window }: { window: TimeWindow }) => {
  const { range } = useSecurity();
  const grain = GRAIN_FOR_RANGE[range];
  const q = useSiemQuery('timeline', { body: { window, grain, index_name: 'all_events' } });
  return (
    <Panel title="Activity over time">
      <QueryBoundary query={q} isEmpty={(d) => d.points.length === 0} empty={<EmptyState title="No events in this window" hint="Nothing has been recorded for the selected range." />}>
        {(d) => <RollupChart points={d.points} grain={d.grain} label="Events over time" zoom height={300} />}
      </QueryBoundary>
    </Panel>
  );
};

/** Horizontal bars, largest on top. The same buckets are always also rendered as a table. */
function buildBarOption(buckets: readonly Bucket[], seriesName: string): ReactEChartsProps['option'] {
  const rows = [...buckets].sort((a, b) => b.count - a.count);
  return {
    animation: false,
    grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
    tooltip: { trigger: 'item', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', minInterval: 1, splitLine: { show: false } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.key), axisLabel: { width: 130, overflow: 'truncate', formatter: (v: string) => neutraliseBraces(String(v)) } },
    series: [{ name: seriesName, type: 'bar', data: rows.map((r) => r.count), label: { show: true, position: 'right' }, barMaxWidth: 18 }],
  };
}

const describeBuckets = (title: string, buckets: readonly Bucket[]): string =>
  `${title}: ${[...buckets].sort((a, b) => b.count - a.count).map((b) => `${b.key} ${b.count.toLocaleString('en-US')}`).join(', ') || 'none'}.`;

/** Queries that carry no time window do not change when the shell's Refresh button is pressed; this re-fetches them. */
function useRefreshOnKey<T>(q: QueryState<T>): void {
  const { refreshKey } = useSecurity();
  const seen = useRef(refreshKey);
  const refresh = q.refresh;
  useEffect(() => {
    if (seen.current !== refreshKey) { seen.current = refreshKey; void refresh(); }
  }, [refreshKey, refresh]);
}

export default OverviewTab;

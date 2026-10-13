import React from 'react';
import { Badge, Code, Divider, Drawer, Group, Paper, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { AlertGroup } from '@/lib/vectis-kit/spec';
import { SEVERITY_LABEL } from '@/lib/vectis-kit/spec';
import { WhyPanel } from '@/lib/vectis-kit/explain/WhyPanel';
import { useSecurity } from '../context';
import { formatBytes, formatNumber, formatTime } from '@/lib/vectis-kit/ui/format';
import { CopyIcon, EmptyState, EntityLink, Panel, QueryBoundary, SeverityBadge, StatusBadge, TierBadge, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import AiAnalystSlot from '../alerts/AiAnalystSlot';
import AlertActions from '../alerts/AlertActions';
import { ControlCell } from '../alerts/AlertsTable';
import Time from '@/lib/vectis-kit/ui/Time';
import { guessEntityType } from '@/lib/vectis-kit/spec/indicator';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Table.Tr><Table.Th scope="row" w={190} fw={500}>{label}</Table.Th><Table.Td>{children}</Table.Td></Table.Tr>
);
const num = (v: number | null | undefined, fmt: (n: number) => string = formatNumber) => (v === null || v === undefined ? <Unmeasured /> : <Text span size="sm">{fmt(v)}</Text>);

const Facts = ({ g }: { g: AlertGroup }) => (
  <Table withRowBorders aria-label="Key facts">
    <Table.Tbody>
      <Row label="Tier"><TierBadge tier={g.detector_tier} /></Row>
      <Row label="Status"><StatusBadge status={g.status ?? 'new'} /></Row>
      <Row label="Assignee"><Text span size="sm">{g.assignee || '—'}</Text></Row>
      <Row label="Disposition"><Text span size="sm">{g.disposition ? g.disposition.replace('_', ' ') : '—'}</Text></Row>
      <Row label="First seen"><Time iso={g.first_seen} /></Row>
      <Row label="Last seen"><Time iso={g.last_seen} /></Row>
      <Row label="Events">{num(g.occurrence_count)}</Row>
      <Row label="Source addresses">{num(g.distinct_src_ips)}</Row>
      <Row label="Accounts">{num(g.distinct_accounts)}</Row>
      <Row label="Countries">{num(g.distinct_countries)}</Row>
      <Row label="Tenants affected">{num(g.tenants_affected)}</Row>
      <Row label="Allowed / blocked"><ControlCell g={g} /></Row>
      <Row label="Largest response">{num(g.bytes_out_max, formatBytes)}</Row>
      <Row label="Response size p99">{num(g.bytes_out_p99, formatBytes)}</Row>
      <Row label="Robust z-score">{num(g.robust_zscore, (n) => n.toFixed(2))}</Row>
      <Row label="Novelty score">{num(g.novelty_score, (n) => n.toFixed(2))}</Row>
      <Row label="Case"><Text span size="sm" ff="monospace">{g.case_id || '—'}</Text></Row>
    </Table.Tbody>
  </Table>
);

/** The sticky top of the drawer: the plain-language verdict and the control counts, visible however far the analyst scrolls. */
const Summary = ({ g, verdict, loading }: { g: AlertGroup | undefined; verdict: string | null | undefined; loading: boolean }) => (
  <Paper
    withBorder p="sm" radius="md" data-testid="alert-summary" aria-label="Summary"
    style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--mantine-color-body)', boxShadow: 'var(--mantine-shadow-xs)' }}
  >
    <Stack gap={6}>
      {verdict ? <Text size="sm" fw={500} data-testid="summary-verdict" style={{ overflowWrap: 'anywhere' }}>{verdict}</Text>
        : loading ? <Skeleton height={36} radius="sm" aria-label="Loading the summary" />
          : <Text size="sm" c="dimmed">No plain-language summary is available for this alert.</Text>}
      {g ? <ControlCell g={g} /> : null}
    </Stack>
  </Paper>
);

const AlertDrawer = ({ groupId, onClose }: { groupId: string; onClose: () => void }) => {
  const { openAlert, goTab } = useSecurity();
  const alerts = useSiemQuery('alertGet', { params: { id: groupId } });
  const why = useSiemQuery('alertWhy', { params: { id: groupId } });
  const similar = useSiemQuery('similar', { body: { group_id: groupId, k: 5 } });
  const group = alerts.data;

  return (
    <Drawer
      opened
      onClose={onClose}
      position="right"
      size="xl"
      returnFocus
      title={
        <Group gap="xs" wrap="nowrap" aria-label={`Alert ${groupId}`}>
          {group ? <SeverityBadge severity={group.severity} /> : null}
          <Stack gap={0}>
            <Title order={4} component="span">{group ? group.title : `Alert ${groupId}`}</Title>
            {group?.rule_id ? <Text size="xs" c="dimmed" ff="monospace">{group.rule_id}</Text> : null}
          </Stack>
        </Group>
      }
    >
      <Stack gap="md">
        <Summary g={group} verdict={why.data?.verdict} loading={why.loading || alerts.loading} />
        <Panel title="Why this fired">
          <QueryBoundary query={why} isEmpty={(d) => d.sections.length === 0 && !d.verdict && !d.evidence} empty={<EmptyState title="No explanation was recorded for this alert" />} rows={3}>
            {(d) => (
              <Stack gap="xs">
                <WhyPanel sections={d.sections} verdict={d.verdict} evidence={d.evidence} renderEntity={(type, value) => <EntityLink type={type} value={value} />} onOpenAlert={(id) => openAlert(id)} />
                <Text size="xs" c="dimmed">Explained as of {formatTime(d.as_of)}</Text>
              </Stack>
            )}
          </QueryBoundary>
        </Panel>

        <QueryBoundary query={alerts} empty={<EmptyState title="This alert was not found" hint="It may belong to another tenant, or it may have been removed." />} isEmpty={(d) => !d} rows={5}>
          {() => (group ? (
            <>
              <Panel title="Key facts"><Facts g={group} /></Panel>
              {group.matched_indicators?.length && !why.data?.sections.some((x) => x.kind === 'indicator') ? (
                <Panel title="Matched indicators">
                  <Group gap="sm">{group.matched_indicators.map((v) => <EntityLink key={v} type={guessEntityType(v)} value={v} />)}</Group>
                </Panel>
              ) : null}
              {group.techniques?.length ? (
                <Group gap={6} role="group" aria-label="Techniques">
                  {group.techniques.map((t) => <Badge key={t} variant="light" radius="sm">{t}</Badge>)}
                </Group>
              ) : null}
              <Panel title="Evidence">
                {group.evidence_uri ? (
                  <Group gap="xs" wrap="nowrap">
                    <Code style={{ overflowWrap: 'anywhere' }} data-testid="evidence-uri">{group.evidence_uri}</Code>
                    <CopyIcon value={group.evidence_uri} what="the evidence location" />
                  </Group>
                ) : <Text size="sm" c="dimmed">No evidence location was recorded.</Text>}
                <Text size="xs" c="dimmed" mt={4}>Shown as text and never opened for you. Fetch it with your approved tools.</Text>
              </Panel>
            </>
          ) : null)}
        </QueryBoundary>

        <Panel title="AI analyst"><AiAnalystSlot groupId={groupId} /></Panel>

        <Panel title="Similar alerts">
          <QueryBoundary query={similar} isEmpty={(d) => d.hits.length === 0} empty={<EmptyState title="No similar alerts" />} rows={2}>
            {(d) => (
              <Stack gap={6} component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
                {d.hits.map((h) => (
                  <li key={h.group_id}>
                    <Group gap="xs">
                      <Badge size="xs" radius="sm" variant="outline" color="gray">{SEVERITY_LABEL[h.severity]}</Badge>
                      <Text component="button" type="button" size="sm" c="blue" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => openAlert(h.group_id)}>{h.title}</Text>
                      <Text size="xs" c="dimmed">distance {h.distance.toFixed(2)}</Text>
                    </Group>
                  </li>
                ))}
              </Stack>
            )}
          </QueryBoundary>
          <Text size="xs" mt={6}>
            <Text component="button" type="button" size="xs" c="blue" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => goTab('hunt', { similar: groupId })}>Search for more in Hunt</Text>
          </Text>
        </Panel>

        <Divider />
        <Panel title="Actions">
          {group ? <AlertActions key={group.group_id} group={group} /> : <Text size="sm" c="dimmed">Actions are available once the alert has loaded.</Text>}
        </Panel>
      </Stack>
    </Drawer>
  );
};
export default AlertDrawer;

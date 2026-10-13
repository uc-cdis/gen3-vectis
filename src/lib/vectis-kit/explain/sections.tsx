import React from 'react';
import { Anchor, Badge, Group, List, SimpleGrid, Stack, Table, Text, Timeline } from '@mantine/core';
import type {
  EntityType, FeatureDiff, IndicatorMatch, SequenceStage, WhyBaseline, WhyEvidence, WhyGraph, WhyIndicator, WhyNovelty, WhyRule, WhySequence,
} from '../spec';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../spec';
import { Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { guessEntityType } from '@/lib/vectis-kit/spec/indicator';
import { formatBytes, formatNumber, formatTime, relativeTime } from '@/lib/vectis-kit/ui/format';

/** How an entity value is shown. The console passes <EntityLink>; the default is plain monospace text. */
export type RenderEntity = (type: EntityType, value: string) => React.ReactNode;
export const plainEntity: RenderEntity = (_t, value) => <Text span ff="monospace" size="sm">{value}</Text>;

interface SectionContext {
  renderEntity: RenderEntity;
  onOpenAlert?: (groupId: string) => void;
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Table.Tr>
    <Table.Th scope="row" w={190} fw={500}>{label}</Table.Th>
    <Table.Td>{children}</Table.Td>
  </Table.Tr>
);
const text = (v: string | null | undefined) => (v ? <Text span size="sm">{v}</Text> : <Text span size="sm" c="dimmed">—</Text>);
const mono = (v: string | null | undefined) => (v ? <Text span size="sm" ff="monospace">{v}</Text> : <Text span size="sm" c="dimmed">—</Text>);

/** A section whose producer could not compute it. Never shown as zero or empty. */
const NotMeasured = ({ what }: { what: string }) => (
  <Group gap="xs"><Unmeasured reason={`${what} has not been computed for this alert. This is not zero.`} /></Group>
);

export function RuleSection({ s }: { s: WhyRule }) {
  if (!s.measured) return <NotMeasured what="The rule match" />;
  const thirdParty = Boolean(s.pack);
  return (
    <Table withRowBorders aria-label="Matched rule">
      <Table.Tbody>
        <Fact label="Rule">
          {s.rule_id?.startsWith('ioc:')
            ? <Text span size="sm">Threat-intel indicator match <Text span size="xs" c="dimmed">(the matched indicator is listed below)</Text></Text>
            : mono(s.rule_id)}
        </Fact>
        <Fact label="Matched">{text(s.matched)}</Fact>
        <Fact label="Origin">
          {thirdParty ? (
            <Group gap={6}>
              <Badge variant="outline" color="gray" radius="sm">Third-party pack</Badge>
              <Text span size="sm" ff="monospace">{s.pack}</Text>
            </Group>
          ) : <Badge variant="outline" color="gray" radius="sm">First-party rule</Badge>}
        </Fact>
        {thirdParty ? <Fact label="Pack commit">{mono(s.pack_commit)}</Fact> : null}
        {thirdParty ? <Fact label="Licence">{text(s.license)}</Fact> : null}
      </Table.Tbody>
    </Table>
  );
}

export function BaselineSection({ s }: { s: WhyBaseline }) {
  if (!s.measured) return <NotMeasured what="The baseline comparison" />;
  const m = s.multiple;
  return (
    <Table withRowBorders aria-label="Baseline comparison">
      <Table.Tbody>
        <Fact label="Endpoint">{mono(s.endpoint)}</Fact>
        <Fact label="Observed">{s.observed_bytes == null ? <Unmeasured /> : <Text span size="sm">{formatBytes(s.observed_bytes)}</Text>}</Fact>
        <Fact label="Historical maximum">{s.historical_max_bytes == null ? <Unmeasured /> : <Text span size="sm">{formatBytes(s.historical_max_bytes)}</Text>}</Fact>
        <Fact label="Multiple of the maximum">{m == null ? <Unmeasured /> : <Text span size="sm" fw={700}>{`${m.toFixed(1)}x`}</Text>}</Fact>
        <Fact label="History used">
          {s.history_days == null || s.samples == null ? <Unmeasured /> : <Text span size="sm">{`${formatNumber(s.history_days)} days, ${formatNumber(s.samples)} samples`}</Text>}
        </Fact>
      </Table.Tbody>
    </Table>
  );
}

const STAGE_LABEL: Record<SequenceStage['stage'], string> = { recon: 'Recon', attack: 'Attack', impact: 'Impact' };
const STAGE_COLOR: Record<SequenceStage['stage'], string> = { recon: 'blue', attack: 'orange', impact: 'red' };

export function SequenceSection({ s, ctx }: { s: WhySequence; ctx: SectionContext }) {
  if (!s.measured) return <NotMeasured what="The sequence" />;
  const stages = [...(s.stages ?? [])].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="sm">Actor</Text>
        {s.actor ? ctx.renderEntity(guessEntityType(s.actor), s.actor) : <Text span size="sm" c="dimmed">—</Text>}
        {s.proof ? <Badge color="red" variant="light" radius="sm">Proof: the sequence completed</Badge> : <Badge color="gray" variant="light" radius="sm">Not proven</Badge>}
      </Group>
      {stages.length === 0 ? <Text size="sm" c="dimmed">No stages were recorded.</Text> : (
        <Timeline active={stages.length} bulletSize={18} lineWidth={2} aria-label="Sequence timeline" component="ol">
          {stages.map((st) => (
            <Timeline.Item key={`${st.at}-${st.group_id ?? st.title}`} color={STAGE_COLOR[st.stage]} title={<><Badge size="xs" radius="sm" color={STAGE_COLOR[st.stage]} mr={6}>{STAGE_LABEL[st.stage]}</Badge>{st.title}</>}>
              <Text size="xs" c="dimmed" component="time" dateTime={st.at} title={formatTime(st.at)}>{formatTime(st.at)} ({relativeTime(st.at)})</Text>
              <Group gap={8}>
                {st.rule_id ? <Text size="xs" ff="monospace">{st.rule_id}</Text> : null}
                {st.group_id && ctx.onOpenAlert ? (
                  <Anchor component="button" type="button" size="xs" onClick={() => ctx.onOpenAlert?.(st.group_id as string)}>Open this alert</Anchor>
                ) : null}
              </Group>
            </Timeline.Item>
          ))}
        </Timeline>
      )}
    </Stack>
  );
}

const DiffTable = ({ rows }: { rows: FeatureDiff[] }) => (
  <Table withRowBorders fz="xs" aria-label="Differing features">
    <Table.Thead><Table.Tr><Table.Th>Feature</Table.Th><Table.Th>This alert</Table.Th><Table.Th>Nearest</Table.Th></Table.Tr></Table.Thead>
    <Table.Tbody>
      {rows.map((r) => (
        <Table.Tr key={r.feature}>
          <Table.Td>{r.feature}</Table.Td>
          <Table.Td>{r.this ? <Text span ff="monospace" size="xs">{r.this}</Text> : <Text span size="xs" c="dimmed">not present</Text>}</Table.Td>
          <Table.Td>{r.nearest ? <Text span ff="monospace" size="xs">{r.nearest}</Text> : <Text span size="xs" c="dimmed">not present</Text>}</Table.Td>
        </Table.Tr>
      ))}
    </Table.Tbody>
  </Table>
);

export function NoveltySection({ s, ctx }: { s: WhyNovelty; ctx: SectionContext }) {
  if (!s.measured) return <NotMeasured what="The novelty score" />;
  const neighbors = s.neighbors ?? [];
  return (
    <Stack gap="sm">
      <Group gap="md">
        <Text size="sm">Novelty score <Text span fw={700}>{s.score == null ? <Unmeasured /> : s.score.toFixed(2)}</Text></Text>
        {s.novelty_class ? <Badge variant="light" radius="sm" color={s.novelty_class === 'anomaly' ? 'red' : s.novelty_class === 'drift' ? 'yellow' : 'gray'}>{s.novelty_class}</Badge> : null}
        {s.model ? <Text size="xs" c="dimmed">Model <Text span ff="monospace" size="xs">{s.model}</Text></Text> : null}
      </Group>
      {neighbors.length === 0 ? <Text size="sm" c="dimmed">No similar known signatures were found.</Text> : null}
      {neighbors.map((n) => (
        <Stack key={n.group_id} gap={4} data-testid="novelty-neighbor">
          <Group gap="xs">
            <Badge size="xs" radius="sm" color={SEVERITY_COLOR[n.severity]}>{SEVERITY_LABEL[n.severity]}</Badge>
            {ctx.onOpenAlert ? <Anchor component="button" type="button" size="sm" onClick={() => ctx.onOpenAlert?.(n.group_id)}>{n.title}</Anchor> : <Text size="sm">{n.title}</Text>}
            <Text size="xs" c="dimmed">distance {n.distance.toFixed(2)}</Text>
          </Group>
          {(n.differing ?? []).length ? <DiffTable rows={n.differing ?? []} /> : <Text size="xs" c="dimmed">No feature differences were reported.</Text>}
        </Stack>
      ))}
    </Stack>
  );
}

const TYPE_LABEL: Record<NonNullable<IndicatorMatch['type']>, string> = { ip: 'IP address', domain: 'Domain', url: 'URL', hash: 'File hash', email: 'Email address' };
const NOT_RECORDED = <Text span size="sm" c="dimmed" fs="italic" data-testid="not-recorded">Not recorded</Text>;

const dateOnly = (iso: string) => <Text span size="sm" title={formatTime(iso)}>{formatTime(iso)} <Text span size="xs" c="dimmed">({relativeTime(iso)})</Text></Text>;

/** One matched indicator. The matched value comes first; the intel node id is an identifier and stays secondary. */
function IndicatorCard({ m, ctx }: { m: IndicatorMatch; ctx: SectionContext }) {
  const known = m.type != null;
  return (
    <Stack gap={6} data-testid="indicator-match">
      <Group gap="xs" align="center">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{known ? TYPE_LABEL[m.type as NonNullable<IndicatorMatch['type']>] : 'Indicator'}</Text>
        {known ? <Text span fw={700} size="lg" data-testid="indicator-value">{ctx.renderEntity(m.type as EntityType, m.value)}</Text>
          : <Text span fw={600} size="md" ff="monospace" data-testid="indicator-value">{m.value}</Text>}
        {m.revoked ? <Badge size="sm" color="gray" radius="sm">Revoked</Badge> : null}
      </Group>
      {!known ? <Text size="sm" c="dimmed">The indicator record could not be read from the intel table, so its value, feed and dates are not known.</Text> : null}
      <Table withRowBorders aria-label="Indicator details" fz="sm">
        <Table.Tbody>
          <Fact label="Feed">{m.source ? <Text span size="sm">{m.source}</Text> : NOT_RECORDED}</Fact>
          <Fact label="Confidence">{m.confidence == null ? NOT_RECORDED : <Text span size="sm">{`${m.confidence}/100`}</Text>}</Fact>
          <Fact label="Valid from">{m.valid_from ? dateOnly(m.valid_from) : NOT_RECORDED}</Fact>
          <Fact label="Valid until">{m.valid_until ? dateOnly(m.valid_until) : <Text span size="sm" c="dimmed">No end date recorded</Text>}</Fact>
          {(m.indicator_types ?? []).length ? <Fact label="Indicator type">{(m.indicator_types ?? []).map((t) => <Badge key={t} mr={4} variant="light" color="gray" radius="sm">{t}</Badge>)}</Fact> : null}
          {m.description ? <Fact label="Feed note">{text(m.description)}</Fact> : null}
          {m.indicator_id ? <Fact label="Indicator id">{mono(m.indicator_id)}</Fact> : null}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

export function IndicatorSection({ s, ctx }: { s: WhyIndicator; ctx: SectionContext }) {
  if (!s.measured) return <NotMeasured what="The indicator match" />;
  const matches = s.matches ?? [];
  if (matches.length === 0) return <Text size="sm" c="dimmed">No indicators matched.</Text>;
  return (
    <Stack gap="md" aria-label="Matched indicators">
      {matches.map((m) => <IndicatorCard key={`${m.indicator_id ?? ''}:${m.type}:${m.value}`} m={m} ctx={ctx} />)}
    </Stack>
  );
}

const ACTION_COLOR: Record<string, string> = { ALLOW: 'gray', BLOCK: 'blue', COUNT: 'gray' };

/** What the group's own events show. Paths and rules come from the sampled events; what could not be measured is said so. */
export function EvidenceSection({ e }: { e: WhyEvidence }) {
  const partial = e.events_sampled < e.events_total;
  const paths = e.top_paths ?? [];
  const actions = e.actions ?? [];
  return (
    <Stack gap="sm" data-testid="evidence">
      <Group gap="xs">
        <Badge variant="light" color="gray" radius="sm">{formatNumber(e.events_total)} events</Badge>
        {e.allowed != null ? <Badge variant="light" color="gray" radius="sm" data-testid="evidence-allowed">{formatNumber(e.allowed)} allowed</Badge> : null}
        {e.blocked != null ? <Badge variant="light" color="gray" radius="sm" data-testid="evidence-blocked">{formatNumber(e.blocked)} blocked</Badge> : null}
        <Text size="xs" c="dimmed">{partial ? `Paths and rules are from ${formatNumber(e.events_sampled)} sampled events.` : `All ${formatNumber(e.events_sampled)} events were read.`}</Text>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <div>
          <Text size="xs" c="dimmed" fw={600} mb={2}>Requested paths</Text>
          {paths.length ? (
            <Table withRowBorders fz="sm" aria-label="Requested paths">
              <Table.Tbody>
                {paths.map((p) => (
                  <Table.Tr key={p.key}><Table.Td style={{ overflowWrap: 'anywhere' }}><Text span ff="monospace" size="sm">{p.key}</Text></Table.Td><Table.Td ta="right" w={60}>{formatNumber(p.count)}</Table.Td></Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : <Unmeasured reason="No request path was recorded for the sampled events. This is not zero." />}
        </div>
        <div>
          <Text size="xs" c="dimmed" fw={600} mb={2}>What our controls did</Text>
          {actions.length ? (
            <Table withRowBorders fz="sm" aria-label="Actions taken">
              <Table.Tbody>
                {actions.map((a) => (
                  <Table.Tr key={`${a.action}:${a.rule_id ?? ''}`}>
                    <Table.Td><Badge variant="light" color={ACTION_COLOR[a.action] ?? 'gray'} radius="sm" size="sm">{a.action}</Badge></Table.Td>
                    <Table.Td style={{ overflowWrap: 'anywhere' }}><Text span ff="monospace" size="sm">{a.rule_id ?? 'no rule recorded'}</Text></Table.Td>
                    <Table.Td ta="right" w={60}>{formatNumber(a.count)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : <Unmeasured reason="No action was recorded for the sampled events. This is not zero." />}
        </div>
      </SimpleGrid>
      <Group gap="lg" align="flex-start">
        <Group gap={6}><Text size="sm" c="dimmed">Response status</Text>{e.status_recorded ? <Text size="sm">{(e.status_classes ?? []).map((b) => `${b.key}: ${formatNumber(b.count)}`).join(', ')}</Text> : <Unmeasured reason="The source does not record the response status. This is not zero." />}</Group>
        <Group gap={6}><Text size="sm" c="dimmed">Data volume</Text>{e.bytes_recorded && e.bytes_max != null ? <Text size="sm">{`up to ${formatBytes(e.bytes_max)} in one response`}</Text> : <Unmeasured reason="The source does not record the response size. This is not zero." />}</Group>
        <Group gap={6}><Text size="sm" c="dimmed">Source addresses</Text>{e.distinct_src_ips == null ? <Unmeasured /> : <Text size="sm">{formatNumber(e.distinct_src_ips)}</Text>}</Group>
        <Group gap={6}><Text size="sm" c="dimmed">Countries</Text>{(e.countries ?? []).length ? <Text size="sm">{(e.countries ?? []).map((b) => `${b.key} (${formatNumber(b.count)})`).join(', ')}</Text> : <Unmeasured />}</Group>
      </Group>
      {(e.sensitive_paths ?? []).length ? (
        <Text size="sm" data-testid="sensitive-paths">Sensitive-looking paths requested: <Text span ff="monospace" size="sm">{(e.sensitive_paths ?? []).join(', ')}</Text></Text>
      ) : null}
    </Stack>
  );
}

const TECHNIQUE_ID = /^T\d{4}(\.\d{3})?$/;

export function GraphSection({ s }: { s: WhyGraph }) {
  const shared = s.shared ?? [];
  const techniques = s.techniques ?? [];
  return (
    <Stack gap="xs">
      {techniques.length ? (
        <Group gap={6} role="group" aria-label="Techniques">
          {techniques.map((t) => (TECHNIQUE_ID.test(t)
            ? <Badge key={t} variant="light" radius="sm" component="a" href={`https://attack.mitre.org/techniques/${t.replace('.', '/')}/`} target="_blank" rel="noopener noreferrer" style={{ cursor: 'pointer' }}>{t}</Badge>
            : <Badge key={t} variant="light" radius="sm">{t}</Badge>))}
        </Group>
      ) : null}
      {!s.measured ? <NotMeasured what="The shared-neighbour analysis" /> : shared.length === 0 ? <Text size="sm" c="dimmed">Nothing is shared with other entities.</Text> : (
        <List spacing={4} size="sm" aria-label="Shared neighbours">
          {shared.map((n) => (
            <List.Item key={n.id}>
              <Text span ff="monospace" size="sm">{n.label}</Text> <Text span size="sm" c="dimmed">{n.relation}</Text> <Text span size="sm">({formatNumber(n.count)} shared)</Text>
            </List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}

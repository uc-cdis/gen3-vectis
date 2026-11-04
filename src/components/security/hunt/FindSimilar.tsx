import React, { useState } from 'react';
import { Anchor, Button, Group, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { SegmentedControl } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { EntityType, FindSimilarRequest, FindSimilarResponse, GraphEdge, GraphNode } from '@/lib/vectis-kit/spec';
import { EmptyState, EntityLink, Panel, QueryBoundary, SeverityBadge, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { formatNumber } from '@/lib/vectis-kit/ui/format';
import { safeText } from '@/lib/safe-text';
import { nodeTitleText } from '@/lib/vectis-kit/entity-graph/lens';
import { OriginTags } from '@/lib/vectis-kit/ui/origin';
import type { SimilarSeed } from '../context';
import { useSecurity } from '../context';
import { isIpAddress } from '@/lib/vectis-kit/spec/indicator';
import { validateAlertId, validateEntityValue } from './huntModel';
import { entityTypeOfGraphKind } from '../entities/entityKeys';

const ENTITY_TYPES: EntityType[] = ['ip', 'domain', 'url', 'hash', 'email', 'host', 'user', 'session', 'arn'];
type Kind = 'exact' | 'structural' | 'behavioral' | 'graph';

/** Graph node ids look like "tenant:Label:value" (the value may contain colons). Only kinds the portal has as entities become links. */
function parseNode(id: string, label: string): { value: string; type: EntityType | null } {
  const parts = id.split(':');
  const value = parts.length >= 3 && parts[1] === label ? parts.slice(2).join(':') : id;
  const type = entityTypeOfGraphKind(label, value);
  return { value, type: type === 'ip' && !isIpAddress(value) ? null : type };
}

/** What a kind of graph node means to an analyst, in the order they are listed. */
const KIND_TITLES: [string, string][] = [
  ['Finding', 'Alerts about it'],
  ['Indicator', 'Threat indicators it matches'],
  ['DetectionRule', 'Rules it triggered'],
  ['RequestSignature', 'Kinds of request it sent'],
  ['Domain', 'Sites and hosts it targeted'],
  ['Resource', 'Resources it reached'],
  ['UserAgent', 'User agents it used'],
  ['JA4Fingerprint', 'TLS fingerprints it used'],
  ['LogSource', 'Seen by (log sources)'],
  ['Account', 'Accounts that saw it'],
  ['Asn', 'Network (ASN)'],
  ['Country', 'Country'],
];
const FEATURE_VERB: Record<string, string> = {
  path_signature: 'sent this kind of request', user_agent: 'used this user agent', ja4: 'used this TLS fingerprint', asn: 'came from this network',
};
const OTHER_IPS = 'Other IP addresses';

type Group = { title: string; nodes: GraphNode[] };

/**
 * The graph as an analyst reads it: what ties directly to the searched address, grouped by what it is, then the other addresses that are
 * only reached through those. The traversal starts at the seed, so for an entity search the seed is the first node.
 */
export function groupGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, seedMode: boolean): { direct: Group[]; indirect: Group[] } {
  const seedId = seedMode ? graph.nodes[0]?.id : undefined;
  const near = new Set<string>();
  if (seedId) for (const e of graph.edges) { if (e.src_id === seedId) near.add(e.dst_id); if (e.dst_id === seedId) near.add(e.src_id); }
  const isDirect = (n: GraphNode) => !seedId || n.id === seedId || near.has(n.id);
  const titleOf = new Map(KIND_TITLES);
  const build = (nodes: GraphNode[]): Group[] => {
    const by = new Map<string, GraphNode[]>();
    for (const n of nodes) by.set(n.label, [...(by.get(n.label) ?? []), n]);
    const order = [...KIND_TITLES.map(([k]) => k), 'IpAddress'];
    const known = order.filter((k) => by.has(k));
    const rest = [...by.keys()].filter((k) => !order.includes(k));
    return [...known, ...rest].map((k) => ({ title: k === 'IpAddress' ? OTHER_IPS : (titleOf.get(k) ?? k), nodes: by.get(k) ?? [] }));
  };
  const direct = build(graph.nodes.filter((n) => isDirect(n) && n.id !== seedId));
  return { direct, indirect: seedId ? build(graph.nodes.filter((n) => !isDirect(n))) : [] };
}

const Result = ({ kind, title, hint, measured, reason, children, count }: { kind: Kind; title: string; hint?: string; measured: boolean; reason: string; children: React.ReactNode; count: number }) => (
  <section aria-label={title} data-testid={`similar-${kind}`}>
    <Group gap={6} mb={4}>
      <Text fw={600} size="sm">{title}</Text>
      {measured ? <Text size="xs" c="dimmed">{formatNumber(count)}</Text> : null}
    </Group>
    {hint ? <Text size="xs" c="dimmed" mb={4}>{hint}</Text> : null}
    {measured ? (count === 0 ? <Text size="sm" c="dimmed">No matches.</Text> : children) : <Unmeasured reason={reason} />}
  </section>
);

export const GroupList = ({ groups, grid = false }: { groups: Group[]; grid?: boolean }) => {
  const sections = groups.map((g) => (
    <div key={g.title}>
      <Text size="xs" fw={600} c="dimmed" mb={2}>{g.title} ({formatNumber(g.nodes.length)})</Text>
      <Group gap="sm">
        {g.nodes.map((n) => {
          const { value, type } = parseNode(n.id, n.label);
          // A request kind, user agent or fingerprint is a hash as an id: show the name the graph records for it, the hash on hover.
          const name = nodeTitleText(n, undefined, 120);
          return <span key={n.id}>{type ? <EntityLink type={type} value={value} /> : <Text span size="sm" title={value !== name ? value : undefined} ff={name === value ? 'monospace' : undefined} style={{ overflowWrap: 'anywhere' }}>{name}</Text>}</span>;
        })}
      </Group>
    </div>
  ));
  return grid ? <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">{sections}</SimpleGrid> : <Stack gap={6}>{sections}</Stack>;
};

const GraphGroups = ({ graph, seedMode }: { graph: { nodes: GraphNode[]; edges: GraphEdge[]; truncated?: boolean }; seedMode: boolean }) => {
  const { direct, indirect } = groupGraph(graph, seedMode);
  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">{graph.nodes.length} nodes, {graph.edges.length} edges{graph.truncated ? ' (more exists than is shown)' : ''}</Text>
      <GroupList groups={direct} />
      {indirect.length > 0 ? (
        <div>
          <Text size="xs" fw={700} mb={2}>Reached through those (not this address itself)</Text>
          <GroupList groups={indirect} />
        </div>
      ) : null}
    </Stack>
  );
};

const Results = ({ data, seedMode, compact }: { data: FindSimilarResponse; seedMode: boolean; compact: boolean }) => {
  const { openAlert } = useSecurity();
  const m = (k: Kind) => data.measured?.[k] === true;
  const exact = data.exact ?? [];
  const structural = data.structural ?? [];
  const behavioral = data.behavioral ?? [];
  const graph = data.graph ?? null;
  const list = { listStyle: 'none' } as const;
  return (
    <Stack gap="md">
      <Result kind="exact" title="Exact" hint="Alerts and threat-intel matches about this exact value." measured={m('exact')} reason="Indicator matches were not computed for this search." count={exact.length}>
        <Stack gap={4} component="ul" m={0} p={0} style={list}>
          {exact.map((g) => (
            <li key={g.group_id}>
              <Group gap="xs" wrap="nowrap"><SeverityBadge severity={g.severity} /><Anchor component="button" type="button" size="sm" ta="left" onClick={() => openAlert(g.group_id)} title={`Open alert ${g.group_id}`}>{g.title}</Anchor></Group>
              <OriginTags compact origin={{ account: g.origin_account, accounts: g.origin_accounts, environments: g.origin_environments, sources: g.origin_sources }} />
            </li>
          ))}
        </Stack>
      </Result>
      <Result kind="structural" title="Structural" hint="Other addresses that act the same way as this one. The number is how many such things they share with it." measured={m('structural')} reason="Structural matches were not computed for this search." count={structural.length}>
        <Stack gap="xs" component="ul" m={0} p={0} style={list}>
          {structural.map((s) => (
            <li key={`${s.feature}:${s.value}`}>
              <Text size="xs" c="dimmed">Also {FEATURE_VERB[s.feature] ?? 'shared'}: <Text span ff={s.label ? undefined : 'monospace'} size="xs" c="dark" title={s.label ? s.value : undefined}>{safeText(s.label ?? s.value, 200)}</Text></Text>
              <Group gap="sm">
                {s.entities.map((b, i) => (
                  <Text key={`${b.key}#${i}`} span size="sm">{isIpAddress(b.key) ? <EntityLink type="ip" value={b.key} /> : b.key} <Text span size="xs" c="dimmed">({formatNumber(b.count)})</Text></Text>
                ))}
              </Group>
            </li>
          ))}
        </Stack>
      </Result>
      {compact ? null : <Result kind="behavioral" title="Behavioral" measured={m('behavioral')} reason="Behavioral similarity is not measured yet. This is not zero matches." count={behavioral.length}>
        <Stack gap={4} component="ul" m={0} p={0} style={list}>
          {behavioral.map((h) => (
            <li key={h.group_id}>
              <Group gap="xs" wrap="nowrap"><SeverityBadge severity={h.severity} /><Anchor component="button" type="button" size="sm" ta="left" onClick={() => openAlert(h.group_id)} title={`Open alert ${h.group_id}`}>{h.title}</Anchor><Text size="xs" c="dimmed">distance {h.distance.toFixed(3)}</Text></Group>
              <OriginTags compact origin={{ account: h.origin_account, environments: h.origin_environments, sources: h.origin_sources }} />
            </li>
          ))}
        </Stack>
      </Result>}
      {compact ? null : <Result kind="graph" title="Graph" hint="What this did and what it touched, as recorded in the entity graph. Click a name to open it." measured={m('graph')} reason="The graph neighbourhood was not computed for this search." count={graph?.nodes.length ?? 0}>
        {graph ? <GraphGroups graph={graph} seedMode={seedMode} /> : null}
      </Result>}
    </Stack>
  );
};

/** Four labelled result sets from one seed. A set that was not measured shows as Unmeasured, never as an empty list. */
export const FindSimilar = ({ prefill, compact = false, form = true }: { prefill?: SimilarSeed | null; compact?: boolean; form?: boolean }) => {
  // The parent remounts this panel (new `key`) to seed it, so the prefill only initialises state and runs once.
  const [mode, setMode] = useState<'entity' | 'alert'>(prefill?.groupId !== undefined ? 'alert' : 'entity');
  const [type, setType] = useState<EntityType>(prefill?.seed?.type ?? 'ip');
  const [value, setValue] = useState(prefill?.seed?.value ?? '');
  const [alertId, setAlertId] = useState(prefill?.groupId ?? '');
  const [touched, setTouched] = useState(false);
  const [request, setRequest] = useState<FindSimilarRequest | null>(() => {
    if (prefill?.seed && validateEntityValue(prefill.seed.value) === null) return { seed: { type: prefill.seed.type, value: prefill.seed.value.trim() } };
    if (prefill?.groupId !== undefined && validateAlertId(prefill.groupId) === null) return { group_id: prefill.groupId };
    return null;
  });
  const q = useSiemQuery('findSimilar', request ? { body: request } : null);

  const error = !touched ? null : mode === 'entity' ? validateEntityValue(value) : validateAlertId(alertId);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if ((mode === 'entity' ? validateEntityValue(value) : validateAlertId(alertId)) !== null) return;
    setRequest(mode === 'entity' ? { seed: { type, value: value.trim() } } : { group_id: alertId });
  };

  return (
    <Panel title={compact ? 'Who else acts like it' : 'Find similar'}>
      <Stack gap="sm">
        {compact || !form ? null : <form noValidate onSubmit={submit} aria-label="Find similar">
          <Stack gap="xs">
            <SegmentedControl padding={2} size="xs" aria-label="Seed kind" value={mode} onChange={(v) => { setMode(v as 'entity' | 'alert'); setTouched(false); }}
              data={[{ value: 'entity', label: 'Entity' }, { value: 'alert', label: 'Alert id' }]} />
            {mode === 'entity' ? (
              <Group gap="xs" align="flex-start" wrap="nowrap">
                <Select size="xs" label="Type" w={110} data={ENTITY_TYPES} value={type} allowDeselect={false} onChange={(v) => v && setType(v as EntityType)} />
                <TextInput size="xs" label="Value" style={{ flex: 1 }} maxLength={512} value={value} onChange={(e) => setValue(e.currentTarget.value)} error={error} />
              </Group>
            ) : (
              <TextInput size="xs" label="Alert id" maxLength={128} value={alertId} onChange={(e) => setAlertId(e.currentTarget.value)} error={error} />
            )}
            <Group><Button type="submit" size="xs">Find similar</Button></Group>
          </Stack>
        </form>}
        {request ? (
          <QueryBoundary query={q} rows={4}>{(d) => <Results data={d} seedMode={request.seed !== undefined} compact={compact} />}</QueryBoundary>
        ) : <EmptyState title="Nothing searched yet" hint="Give an entity or an alert id to run the four searches." />}
      </Stack>
    </Panel>
  );
};

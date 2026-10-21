import React, { useState } from 'react';
import { Anchor, Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { SegmentedControl } from '@gen3/frontend';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { EntityType, FindSimilarRequest, FindSimilarResponse } from '@/lib/vectis-kit/spec';
import { EmptyState, EntityLink, Panel, QueryBoundary, SeverityBadge, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { formatNumber } from '@/lib/vectis-kit/ui/format';
import { OriginTags } from '@/lib/vectis-kit/ui/origin';
import type { SimilarSeed } from '../context';
import { useSecurity } from '../context';
import { isIpAddress } from '@/lib/vectis-kit/spec/indicator';
import { validateAlertId, validateEntityValue } from './huntModel';

const ENTITY_TYPES: EntityType[] = ['ip', 'domain', 'url', 'hash', 'email', 'host', 'user', 'session', 'arn'];
type Kind = 'exact' | 'structural' | 'behavioral' | 'graph';

/** Graph node ids look like "tenant:Label:value" (the value may contain colons). Only labels we can map become entity links. */
const NODE_ENTITY: Record<string, EntityType> = { IpAddress: 'ip', Domain: 'domain' };
function parseNode(id: string, label: string): { value: string; type: EntityType | null } {
  const parts = id.split(':');
  const value = parts.length >= 3 && parts[1] === label ? parts.slice(2).join(':') : id;
  const type = NODE_ENTITY[label] ?? null;
  return { value, type: type === 'ip' && !isIpAddress(value) ? null : type };
}

const Result = ({ kind, title, measured, reason, children, count }: { kind: Kind; title: string; measured: boolean; reason: string; children: React.ReactNode; count: number }) => (
  <section aria-label={title} data-testid={`similar-${kind}`}>
    <Group gap={6} mb={4}>
      <Text fw={600} size="sm">{title}</Text>
      {measured ? <Text size="xs" c="dimmed">{formatNumber(count)}</Text> : null}
    </Group>
    {measured ? (count === 0 ? <Text size="sm" c="dimmed">No matches.</Text> : children) : <Unmeasured reason={reason} />}
  </section>
);

const Results = ({ data }: { data: FindSimilarResponse }) => {
  const { openAlert } = useSecurity();
  const m = (k: Kind) => data.measured?.[k] === true;
  const exact = data.exact ?? [];
  const structural = data.structural ?? [];
  const behavioral = data.behavioral ?? [];
  const graph = data.graph ?? null;
  const list = { listStyle: 'none' } as const;
  return (
    <Stack gap="md">
      <Result kind="exact" title="Exact" measured={m('exact')} reason="Indicator matches were not computed for this search." count={exact.length}>
        <Stack gap={4} component="ul" m={0} p={0} style={list}>
          {exact.map((g) => (
            <li key={g.group_id}>
              <Group gap="xs" wrap="nowrap"><SeverityBadge severity={g.severity} /><Anchor component="button" type="button" size="sm" ta="left" onClick={() => openAlert(g.group_id)} title={`Open alert ${g.group_id}`}>{g.title}</Anchor></Group>
              <OriginTags compact origin={{ account: g.origin_account, accounts: g.origin_accounts, environments: g.origin_environments, sources: g.origin_sources }} />
            </li>
          ))}
        </Stack>
      </Result>
      <Result kind="structural" title="Structural" measured={m('structural')} reason="Structural matches were not computed for this search." count={structural.length}>
        <Stack gap="xs" component="ul" m={0} p={0} style={list}>
          {structural.map((s) => (
            <li key={`${s.feature}:${s.value}`}>
              <Text size="xs" c="dimmed">Same {s.feature.replace('_', ' ')}: <Text span ff="monospace" size="xs" c="dark">{s.value}</Text></Text>
              <Group gap="sm">
                {s.entities.map((b) => (
                  <Text key={b.key} span size="sm">{isIpAddress(b.key) ? <EntityLink type="ip" value={b.key} /> : b.key} <Text span size="xs" c="dimmed">({formatNumber(b.count)})</Text></Text>
                ))}
              </Group>
            </li>
          ))}
        </Stack>
      </Result>
      <Result kind="behavioral" title="Behavioral" measured={m('behavioral')} reason="Behavioral similarity is not measured yet. This is not zero matches." count={behavioral.length}>
        <Stack gap={4} component="ul" m={0} p={0} style={list}>
          {behavioral.map((h) => (
            <li key={h.group_id}>
              <Group gap="xs" wrap="nowrap"><SeverityBadge severity={h.severity} /><Anchor component="button" type="button" size="sm" ta="left" onClick={() => openAlert(h.group_id)} title={`Open alert ${h.group_id}`}>{h.title}</Anchor><Text size="xs" c="dimmed">distance {h.distance.toFixed(3)}</Text></Group>
              <OriginTags compact origin={{ account: h.origin_account, environments: h.origin_environments, sources: h.origin_sources }} />
            </li>
          ))}
        </Stack>
      </Result>
      <Result kind="graph" title="Graph" measured={m('graph')} reason="The graph neighbourhood was not computed for this search." count={graph?.nodes.length ?? 0}>
        <Text size="xs" c="dimmed" mb={4}>{graph?.nodes.length} nodes, {graph?.edges.length} edges{graph?.truncated ? ' (truncated)' : ''}</Text>
        <Stack gap={2} component="ul" m={0} p={0} style={list}>
          {graph?.nodes.map((n) => {
            const { value, type } = parseNode(n.id, n.label);
            return <li key={n.id}><Text span size="xs" c="dimmed">{n.label}: </Text>{type ? <EntityLink type={type} value={value} /> : <Text span size="sm" ff="monospace">{value}</Text>}</li>;
          })}
        </Stack>
      </Result>
    </Stack>
  );
};

/** Four labelled result sets from one seed. A set that was not measured shows as Unmeasured, never as an empty list. */
export const FindSimilar = ({ prefill }: { prefill?: SimilarSeed | null }) => {
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
    <Panel title="Find similar">
      <Stack gap="sm">
        <form noValidate onSubmit={submit} aria-label="Find similar">
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
        </form>
        {request ? (
          <QueryBoundary query={q} rows={4}>{(d) => <Results data={d} />}</QueryBoundary>
        ) : <EmptyState title="Nothing searched yet" hint="Give an entity or an alert id to run the four searches." />}
      </Stack>
    </Panel>
  );
};

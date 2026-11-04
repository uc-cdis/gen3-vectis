import React from 'react';
import { Anchor, Badge, Group, Stack, Text, Title } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { EntitySeed } from '@/lib/vectis-kit/spec';
import { CopyValue } from '@/lib/vectis-kit/entity-card/blocks';
import { safeText } from '@/lib/safe-text';
import { formatNumber, formatTime, relativeTime } from '@/lib/vectis-kit/ui/format';
import { Panel, QueryBoundary, SeverityBadge } from '@/lib/vectis-kit/ui/primitives';
import { ENTITY_TYPE_LABEL } from '../entities/entityKeys';
import { useSecurity } from '../context';

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <Text size="xs" c="dimmed">{label}</Text>
    <Text size="sm" fw={500}>{children}</Text>
  </div>
);

/** The first thing to read: who this is, whether anyone has flagged it, and when it was active. Everything else on the page is detail behind this. */
export const HuntSummary = ({ seed }: { seed: EntitySeed }) => {
  const { openAlert } = useSecurity();
  const query = useSiemQuery('entityProfile', { body: { type: seed.type, value: seed.value } });
  return (
    <Panel title="Summary">
      <QueryBoundary query={query} rows={3}>
        {(p) => {
          const groups = p.groups ?? [];
          const matches = p.indicator_matches ?? [];
          const feeds = [...new Set(matches.map((m) => m.source).filter((v): v is string => !!v))];
          const asn = p.geo?.asn === null || p.geo?.asn === undefined ? null : `AS${p.geo.asn}${p.geo.asn_org ? ` (${safeText(p.geo.asn_org, 60)})` : ''}`;
          return (
            <Stack gap="sm">
              <Group gap="xs" align="center">
                <Badge variant="light" color="gray">{ENTITY_TYPE_LABEL[p.type]}</Badge>
                <Title order={3} ff="monospace">{safeText(p.value, 120)}</Title>
                <CopyValue value={p.value} what="entity value" />
              </Group>
              <Group gap="xs" data-testid="hunt-verdict">
                {matches.length > 0
                  ? <Badge color="red" variant="filled">Known threat: {matches.length} indicator match{matches.length === 1 ? '' : 'es'}{feeds.length ? ` (${feeds.map((f) => safeText(f, 40)).join(', ')})` : ''}</Badge>
                  : <Badge color="gray" variant="light">No threat-intel match</Badge>}
                {groups.length > 0
                  ? <Badge color="orange" variant="light">{groups.length} alert group{groups.length === 1 ? '' : 's'}</Badge>
                  : <Badge color="gray" variant="light">No alerts</Badge>}
                {p.cases && p.cases.length > 0 ? <Badge color="blue" variant="light">In {p.cases.length} case{p.cases.length === 1 ? '' : 's'}</Badge> : null}
              </Group>
              <Group gap="xl" wrap="wrap">
                <Fact label="Country">{p.geo?.country ?? 'Unmeasured'}</Fact>
                <Fact label="Network">{asn ?? 'Unmeasured'}</Fact>
                <Fact label="First seen">{p.first_seen ? formatTime(p.first_seen) : 'Unmeasured'}</Fact>
                <Fact label="Last active">{p.last_seen ? `${formatTime(p.last_seen)} (${relativeTime(p.last_seen)})` : 'Unmeasured'}</Fact>
                <Fact label="Events">{p.event_count === null || p.event_count === undefined ? 'Unmeasured' : formatNumber(p.event_count)}</Fact>
              </Group>
              {groups.length > 0 ? (
                <Stack gap={4}>
                  {groups.slice(0, 3).map((g) => (
                    <Group key={g.group_id} gap="xs" wrap="nowrap">
                      <SeverityBadge severity={g.severity} />
                      <Anchor component="button" type="button" size="sm" ta="left" onClick={() => openAlert(g.group_id)} aria-label={`Open alert ${safeText(g.title, 256)}`}>{safeText(g.title, 256)}</Anchor>
                      <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{formatNumber(g.occurrence_count)} events, {relativeTime(g.last_seen)}</Text>
                    </Group>
                  ))}
                  {groups.length > 3 ? <Text size="xs" c="dimmed">{groups.length - 3} more in Details below.</Text> : null}
                </Stack>
              ) : null}
            </Stack>
          );
        }}
      </QueryBoundary>
    </Panel>
  );
};

import React, { useMemo, useState } from 'react';
import { Anchor, Badge, Button, Drawer, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { EntityProfileResponse, EntitySeed, IndicatorMatch } from '@/lib/vectis-kit/spec';
import { CopyValue, FactList, SimpleTable } from '@/lib/vectis-kit/entity-card/blocks';
import { safeText } from '@/lib/safe-text';
import { encodeEntity, useSecurity } from '../context';
import { formatNumber, formatTime, relativeTime } from '@/lib/vectis-kit/ui/format';
import { QueryBoundary, SeverityBadge, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { ENTITY_TYPE_LABEL } from '../entities/entityKeys';
import { isIocType } from '@/lib/vectis-kit/spec/indicator';
import { EntityGraphSection } from '../entities/EntityGraphSection';
import { SourceMix } from '../entities/SourceMix';
import { QuickWatchlistAdd } from '../intel/QuickWatchlistAdd';

const orUnmeasured = (v: string | number | null | undefined, fmt: (v: never) => string = String): React.ReactNode =>
  v === null || v === undefined || v === '' ? <Unmeasured /> : fmt(v as never);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-label={title}>
    <Title order={5} mb="xs">{title}</Title>
    {children}
  </section>
);

const IndicatorMatches = ({ matches }: { matches: IndicatorMatch[] }) => {
  const columns = useMemo<MRT_ColumnDef<IndicatorMatch>[]>(() => [
    { accessorFn: (m) => safeText(m.value, 120), id: 'value', header: 'Value' },
    { accessorFn: (m) => safeText(m.source ?? '', 60), id: 'source', header: 'Source', Cell: ({ row }) => orUnmeasured(row.original.source, (v) => safeText(String(v), 60)) },
    { accessorFn: (m) => m.confidence ?? -1, id: 'confidence', header: 'Confidence', size: 100, Cell: ({ row }) => orUnmeasured(row.original.confidence) },
    { accessorFn: (m) => m.first_seen ?? '', id: 'age', header: 'Age', size: 100, Cell: ({ row }) => (row.original.first_seen ? relativeTime(row.original.first_seen).replace(' ago', '') : <Unmeasured />) },
    { accessorFn: (m) => (m.revoked ? 'revoked' : 'active'), id: 'status', header: 'Status', size: 90 },
  ], []);
  return <SimpleTable columns={columns} data={matches} caption="Indicator matches" pageSize={5} />;
};

const Body = ({ seed }: { seed: EntitySeed }) => {
  const { openAlert, goTab } = useSecurity();
  const query = useSiemQuery('entityProfile', { body: { type: seed.type, value: seed.value } });
  const [watching, setWatching] = useState(false);

  const view = (p: EntityProfileResponse) => {
    return (
      <Stack gap="lg">
        <Section title="Identity">
          <Stack gap="xs">
            <Group gap="xs">
              <Badge variant="light" color="gray">{ENTITY_TYPE_LABEL[p.type]}</Badge>
              <CopyValue value={p.value} what="entity value" />
            </Group>
            <FactList label="Entity facts" facts={[
              { label: 'Key', value: <CopyValue value={p.key} what="entity key" /> },
              { label: 'Country', value: orUnmeasured(p.geo?.country) },
              { label: 'City', value: orUnmeasured(p.geo?.city) },
              { label: 'ASN', value: p.geo?.asn === null || p.geo?.asn === undefined ? <Unmeasured /> : `AS${p.geo.asn}${p.geo.asn_org ? ` (${safeText(p.geo.asn_org, 80)})` : ''}` },
              { label: 'First seen', value: orUnmeasured(p.first_seen, (v) => formatTime(v as string)) },
              { label: 'Last seen', value: orUnmeasured(p.last_seen, (v) => formatTime(v as string)) },
              { label: 'Events', value: orUnmeasured(p.event_count, (v) => formatNumber(v as number)) },
            ]} />
            <Group gap="xs">
              <Tooltip label={isIocType(p.type) ? 'Publish this value as an indicator' : 'Only addresses, domains, URLs, hashes and email addresses can be watched'} withArrow>
                <Button size="xs" variant="default" disabled={!isIocType(p.type)} aria-expanded={watching} onClick={() => setWatching((w) => !w)}>Add to watchlist</Button>
              </Tooltip>
              <Button size="xs" variant="default" onClick={() => goTab('hunt', { similar: encodeEntity(seed) })}>Find similar</Button>
            </Group>
            {watching ? <QuickWatchlistAdd seed={seed} /> : null}
          </Stack>
        </Section>

        <Section title="Source mix">
          {p.sources === undefined ? <Unmeasured /> : p.sources.length === 0 ? <Text size="sm" c="dimmed">No events by source.</Text> : <SourceMix sources={p.sources} />}
        </Section>

        <Section title="Alert groups">
          {p.groups === undefined ? <Unmeasured /> : p.groups.length === 0 ? <Text size="sm" c="dimmed">No alert groups name this entity.</Text> : (
            <Stack gap={6}>
              {p.groups.map((g) => (
                <Group key={g.group_id} gap="xs" wrap="nowrap">
                  <SeverityBadge severity={g.severity} />
                  <Anchor component="button" type="button" size="sm" ta="left" onClick={() => openAlert(g.group_id)} aria-label={`Open alert ${safeText(g.title, 100)}`}>{safeText(g.title, 100)}</Anchor>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{formatNumber(g.occurrence_count)} events, {relativeTime(g.last_seen)}</Text>
                </Group>
              ))}
              {p.dropped ? <Text size="xs" c="yellow.9">{formatNumber(p.dropped)} more matches are not shown.</Text> : null}
            </Stack>
          )}
        </Section>

        <Section title="Cases">
          {p.cases === undefined ? <Unmeasured /> : p.cases.length === 0 ? <Text size="sm" c="dimmed">Not part of any case.</Text> : (
            <Stack gap={6}>
              {p.cases.map((c) => (
                <Group key={c.case_id} gap="xs">
                  <Badge variant="light" color="gray" size="sm">{c.status.replace('_', ' ')}</Badge>
                  <Anchor component="button" type="button" size="sm" onClick={() => goTab('cases', { case: c.case_id })}>{safeText(c.title, 100)}</Anchor>
                </Group>
              ))}
            </Stack>
          )}
        </Section>

        <Section title="Indicator matches">
          {p.indicator_matches === undefined ? <Unmeasured /> : p.indicator_matches.length === 0 ? <Text size="sm" c="dimmed">No indicator matches this entity.</Text> : <IndicatorMatches matches={p.indicator_matches} />}
        </Section>

        <Section title="Graph">
          <EntityGraphSection seed={seed} graphId={p.graph_id} />
        </Section>

        <Text size="xs" c="dimmed">As of {formatTime(p.as_of)}</Text>
      </Stack>
    );
  };

  return <QueryBoundary query={query} rows={6}>{view}</QueryBoundary>;
};

/** One drawer for every entity value in the console (SOC-PLAN.md 15.5). */
const EntityDrawer = ({ seed, onClose }: { seed: EntitySeed; onClose: () => void }) => (
  <Drawer opened onClose={onClose} title={safeText(`${seed.type}: ${seed.value}`, 200)} position="right" size="xl" aria-label="Entity details">
    <Body key={encodeEntity(seed)} seed={seed} />
  </Drawer>
);
export default EntityDrawer;

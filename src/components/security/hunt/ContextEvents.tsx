import React from 'react';
import { Anchor, Badge, Button, Group, Table, Text } from '@mantine/core';
import type { CatalogResponse, EntitySeed } from '@/lib/vectis-kit/spec';
import { safeText } from '@/lib/safe-text';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import { EmptyState, Panel, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { formatTime } from '@/lib/vectis-kit/ui/format';
import { PER_SIDE, dataLinkFor, offsetLabel } from './contextModel';
import { useSecurity } from '../context';
import type { ContextEvent, ContextSpec } from './contextModel';
import { useContextEvents } from './useContextEvents';
import { ExpandableText } from '@/lib/vectis-kit/ui/ExpandableText';

const short = (v: string, n = 44): string => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

/** Every value in an event the hunt can follow. Click one to hunt on it at the same moment; the entity being hunted is not offered. */
const Follow = ({ e, subject, onPivot }: { e: ContextEvent; subject: EntitySeed; onPivot: (seed: EntitySeed) => void }) => {
  const offered = e.pivots.filter((p) => !(p.seed.type === subject.type && p.seed.value === subject.value));
  if (offered.length === 0) return <Text span size="xs" c="dimmed">-</Text>;
  return (
    <Group gap={10} wrap="wrap">
      {offered.map((p) => (
        <Group key={`${p.seed.type}:${p.seed.value}`} gap={4} wrap="nowrap">
          <Text span size="xs" c="dimmed">{p.role}</Text>
          <Anchor component="button" type="button" size="xs" ff="monospace" onClick={() => onPivot(p.seed)} title={`Hunt on this ${p.role}: ${p.seed.value}`}>{short(p.seed.value)}</Anchor>
        </Group>
      ))}
    </Group>
  );
};

const EventRow = ({ e, at, subject, onPivot }: { e: ContextEvent; at: string; subject: EntitySeed; onPivot: (seed: EntitySeed) => void }) => (
  <Table.Tr data-testid="context-event">
    <Table.Td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}><Text size="xs" ff="monospace">{offsetLabel(e.time, at)}</Text></Table.Td>
    <Table.Td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
      <Group gap={4} wrap="nowrap"><Badge variant="light" color="gray" size="xs">{safeText(e.index, 40)}</Badge>{e.source ? <Text size="xs" c="dimmed"><ExpandableText value={e.source} previewChars={40} size="xs" label="source" /></Text> : null}</Group>
    </Table.Td>
    <Table.Td style={{ verticalAlign: 'top' }}>
      <Text size="xs" component="div">{e.summary ? <ExpandableText value={e.summary} previewChars={300} size="xs" label="event summary" /> : <Text span c="dimmed">no detail recorded</Text>}</Text>
      {e.userAgent ? <Text size="xs" c="dimmed" title={e.userAgent} lineClamp={1} style={{ overflowWrap: 'anywhere' }}>{e.userAgent}</Text> : null}
    </Table.Td>
    <Table.Td style={{ verticalAlign: 'top' }}><Follow e={e} subject={subject} onPivot={onPivot} /></Table.Td>
  </Table.Tr>
);

/** Nothing within the window: say when this entity was last active and offer to look there (the profile is already loaded by the page, so this costs nothing). */
const LastActivity = ({ seed, at, onMove }: { seed: EntitySeed; at: string; onMove: (at: string) => void }) => {
  const profile = useSiemQuery('entityProfile', { body: { type: seed.type, value: seed.value } });
  const last = profile.data?.last_seen;
  if (!last || Number.isNaN(Date.parse(last)) || last === at) return null;
  return (
    <Group gap="xs" mt="xs" data-testid="jump-to-last-activity">
      <Text size="sm">Last seen {formatTime(last)}.</Text>
      <Button size="compact-xs" onClick={() => onMove(last)}>Look around that time</Button>
    </Group>
  );
};

/** The events around the moment: the ones just before, a marker for the moment, the ones just after. */
export const ContextEvents = ({ spec, catalog, onPivot, onMove }: { spec: ContextSpec; catalog: CatalogResponse; onPivot: (seed: EntitySeed) => void; onMove?: (at: string) => void }) => {
  const query = useContextEvents(spec, catalog);
  const { goTab } = useSecurity();
  const dataLink = dataLinkFor(spec, catalog);
  const who = spec.scope === 'actor' ? `${spec.seed.value} only` : 'everything in the environment';
  return (
    <Panel title="Around that moment" action={(
      <Group gap="xs">
        <Badge variant="light" color="gray" data-testid="context-scope">{who}</Badge>
        {dataLink ? <Button size="compact-xs" variant="default" onClick={() => goTab('data', dataLink)}>List and download all in Explore</Button> : null}
      </Group>
    )}>
      <Text size="xs" c="dimmed" mb="xs">
        The {PER_SIDE} events before and the {PER_SIDE} after {formatTime(spec.at)}, within {spec.span} minute{spec.span === 1 ? '' : 's'} each way.
      </Text>
      <QueryBoundary query={query} rows={6}>
        {(d) => (
          <>
            {d.before.length === 0 && d.after.length === 0 ? (
              <>
                <EmptyState title="No events in this window" hint={spec.scope === 'actor' ? 'Nothing was recorded for this entity in these minutes. Try a wider span, or switch to everything.' : 'Nothing was recorded in these minutes. Try a wider span.'} />
                {spec.scope === 'actor' && onMove ? <LastActivity seed={spec.seed} at={spec.at} onMove={onMove} /> : null}
              </>
            ) : (
              <Table verticalSpacing={4} horizontalSpacing="xs" highlightOnHover aria-label="Events around the moment">
                <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>Where</Table.Th><Table.Th>What</Table.Th><Table.Th>Hunt on</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {d.before.map((e, i) => <EventRow key={`${e.key}#${i}`} e={e} at={spec.at} subject={spec.seed} onPivot={onPivot} />)}
                  <Table.Tr data-testid="context-moment" style={{ background: 'var(--mantine-color-gray-1)' }}>
                    <Table.Td colSpan={4}><Text size="xs" fw={600}>{formatTime(spec.at)} - the moment</Text></Table.Td>
                  </Table.Tr>
                  {d.after.map((e, i) => <EventRow key={`${e.key}#${i}`} e={e} at={spec.at} subject={spec.seed} onPivot={onPivot} />)}
                </Table.Tbody>
              </Table>
            )}
            {d.notes.map((n, i) => <Text key={`${n}#${i}`} size="xs" c="yellow.9" mt={6}><ExpandableText value={n} previewChars={300} size="xs" label="note" /></Text>)}
          </>
        )}
      </QueryBoundary>
    </Panel>
  );
};

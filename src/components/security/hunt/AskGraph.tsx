import React, { useState } from 'react';
import { Anchor, Badge, Button, Group, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import type { EntitySeed, GraphAskEvents, GraphAskNode, GraphAskStep, GraphPathInfo, IndexName } from '@/lib/vectis-kit/spec';
import { EmptyState, Panel, QueryBoundary } from '@/lib/vectis-kit/ui/primitives';
import { formatNumber } from '@/lib/vectis-kit/ui/format';
import { ExpandableText } from '@/lib/vectis-kit/ui/ExpandableText';
import { seedFromGraphNode, validNodeId } from '../entities/entityKeys';
import { useSecurity } from '../context';
import { huntIndexes, linkForQuery } from './huntModel';

const SHOWN = 20;

/** The kind of a graph id ("tenant:Kind:value"); read, never built. */
const kindOf = (graphId: string): string => graphId.split(':')[1] ?? '';

const nodeName = (n: GraphAskNode): string => {
  const parts = n.id.split(':');
  return n.name ?? (parts.length >= 3 && parts[1] === n.label ? parts.slice(2).join(':') : n.id);
};

type Handlers = { onPivot: (seed: EntitySeed) => void; onAskFrom: (graphId: string) => void };

const Reached = ({ node, onPivot, onAskFrom }: { node: GraphAskNode } & Handlers) => {
  const seed = seedFromGraphNode({ id: node.id, label: node.label, properties: {} });
  return (
    <Group gap="xs" wrap="nowrap">
      <Badge variant="light" color="gray" size="sm" style={{ textTransform: 'none' }}>{node.label}</Badge>
      {seed ? (
        <Anchor component="button" type="button" size="sm" ta="left" onClick={() => onPivot(seed)} title={`Investigate ${seed.value}`}>{nodeName(node)}</Anchor>
      ) : (
        <ExpandableText value={nodeName(node)} previewChars={60} mono size="xs" label="entity" />
      )}
      <Text size="xs" c="dimmed">{formatNumber(node.count)} events</Text>
      {node.reach !== null && node.reach !== undefined ? <Text size="xs" c="dimmed">reached by {formatNumber(node.reach)}</Text> : null}
      <Button size="compact-xs" variant="subtle" aria-label={`Ask from ${nodeName(node)}`} onClick={() => onAskFrom(node.id)}>Ask from here</Button>
    </Group>
  );
};

/** Where a question goes on: the events of the walked entities, opened in the Data tab where they can be paged and downloaded. */
const EventsNext = ({ events }: { events: GraphAskEvents }) => {
  const { goTab } = useSecurity();
  const catalog = useSiemQuery('catalog', {});
  const listed = catalog.data ? huntIndexes(catalog.data).some((i) => i.index_name === events.index_name) : false;
  const filter = events.values.length === 1 ? { field: events.field, op: 'eq' as const, value: events.values[0] } : { field: events.field, op: 'in' as const, value: events.values };
  return (
    <Group gap="xs">
      <Text size="sm">The question goes on in the events: {events.index_name.replace(/_/g, ' ')} where {events.field.replace(/_/g, ' ')} is {events.values.length === 1 ? events.values[0] : `one of ${formatNumber(events.values.length)} entities`}.</Text>
      <Button size="compact-xs" variant="default" disabled={!listed} title={listed ? undefined : 'This kind of event is not listed in Explore yet'}
        onClick={() => goTab('data', linkForQuery({ index: events.index_name as IndexName, range: null, filters: [filter] }))}>List these events in Explore</Button>
    </Group>
  );
};

const Step = ({ step, onPivot, onAskFrom }: { step: GraphAskStep } & Handlers) => {
  const [all, setAll] = useState(false);
  const nodes = all ? step.reached : step.reached.slice(0, SHOWN);
  return (
    <section aria-label={`Step ${step.index + 1}`} data-testid={`ask-step-${step.index}`}>
      <Group gap={6} mb={4}>
        <Text fw={600} size="sm">{step.index + 1}. {step.relation.replace(/_/g, ' ')}</Text>
        <Text size="xs" c="dimmed">{step.from_label} to {step.to_label}</Text>
        {step.events ? null : <Badge variant="light" color={step.truncated ? 'yellow' : 'gray'} size="sm">{formatNumber(step.reached.length)} of {formatNumber(step.total)}</Badge>}
      </Group>
      {step.events ? <EventsNext events={step.events} /> : step.reached.length === 0 ? <Text size="sm" c="dimmed">Nothing in this window.</Text> : (
        <Stack gap={4}>
          {nodes.map((n) => <Reached key={n.id} node={n} onPivot={onPivot} onAskFrom={onAskFrom} />)}
          {step.reached.length > SHOWN ? (
            <Button size="compact-xs" variant="subtle" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${formatNumber(step.reached.length)}`}</Button>
          ) : null}
        </Stack>
      )}
      {step.truncated ? <Text size="xs" c="dimmed" mt={4}>The strongest connections are shown; more exist than were returned.</Text> : null}
    </section>
  );
};

const Questions = ({ graphId, onPivot, onAskFrom }: { graphId: string } & Handlers) => {
  const paths = useSiemQuery('graphPaths', {});
  const [pathId, setPathId] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [rarest, setRarest] = useState(false);
  const answer = useSiemQuery('graphAsk', asked ? { body: { path_id: asked, start_id: graphId, ...(rarest ? { order: 'rarest' as const } : {}) } } : null);
  const kind = kindOf(graphId);
  const [words, setWords] = useState('');
  const [typed, setTyped] = useState<string | null>(null);
  const matches = useSiemQuery('graphMatch', typed ? { body: { text: typed, start: kind } } : null);
  const ask = (id: string) => { setPathId(id); setAsked(id); };

  return (
    <QueryBoundary query={paths} isEmpty={(d) => d.paths.filter((p) => p.start === kind && p.in_graph).length === 0}
      empty={<EmptyState title={`No question starts from a ${kind}`} hint="The data dictionary declares none for this kind of entity." />}>
      {(d) => {
        const mine = d.paths.filter((p: GraphPathInfo) => p.start === kind && p.in_graph);
        const groups = [...new Set(mine.map((p) => p.scenario))].map((scenario) => ({
          group: scenario, items: mine.filter((p) => p.scenario === scenario).map((p) => ({ value: p.id, label: `${p.id}: ${p.title}` })),
        }));
        return (
          <Stack gap="sm">
            <Group align="flex-end" gap="sm" wrap="nowrap">
              <Select size="xs" label="Question" placeholder="Choose what to ask the graph" searchable w="100%" data={groups} value={pathId} onChange={setPathId} />
              <Button size="xs" disabled={!pathId} onClick={() => setAsked(pathId)}>Ask</Button>
            </Group>
            <Switch size="xs" label="Rarest first: what few others reach, not the busiest" checked={rarest} onChange={(e) => setRarest(e.currentTarget.checked)} />
            <form aria-label="Ask in your own words" onSubmit={(e) => { e.preventDefault(); if (words.trim()) setTyped(words.trim()); }}>
              <Group align="flex-end" gap="sm" wrap="nowrap">
                <TextInput size="xs" label="Or ask in your own words" placeholder="where did it go" maxLength={200} w="100%" value={words} onChange={(e) => setWords(e.currentTarget.value)} />
                <Button size="xs" type="submit" variant="default" disabled={!words.trim()}>Find the question</Button>
              </Group>
            </form>
            {typed ? (
              <QueryBoundary query={matches} isEmpty={(m) => m.matches.length === 0}
                empty={<Text size="xs" c="dimmed">No question shares a word with that. Pick one from the list.</Text>}>
                {(m) => (
                  <Group gap="xs" aria-label="Closest questions">
                    {m.matches.map((q) => <Button key={q.id} size="compact-xs" variant="light" title={q.title} onClick={() => ask(q.id)}>{q.id}: {q.title.length > 70 ? `${q.title.slice(0, 70)}…` : q.title}</Button>)}
                  </Group>
                )}
              </QueryBoundary>
            ) : null}
            {asked ? (
              <QueryBoundary query={answer} isEmpty={(a) => a.steps.length === 0 || a.steps.every((s) => s.reached.length === 0 && !s.events)}
                empty={<EmptyState title="The graph has no answer to this in the window" hint="Nothing follows from this entity by that route." />}>
                {(a) => (
                  <Stack gap="md" data-testid="ask-answer">
                    <Text size="xs" c="dimmed">{a.title}</Text>
                    {a.steps.map((s) => <Step key={s.index} step={s} onPivot={onPivot} onAskFrom={onAskFrom} />)}
                    {a.continues_in_events ? <Text size="xs" c="dimmed">This question goes on in the events: open the last entities above to list what they did.</Text> : null}
                  </Stack>
                )}
              </QueryBoundary>
            ) : null}
          </Stack>
        );
      }}
    </QueryBoundary>
  );
};

/** The questions that start from one graph entity, with a way to follow any entity they reach as the next start. */
export const AskFrom = ({ startId, label, onPivot }: { startId: string; label?: string; onPivot: (seed: EntitySeed) => void }) => {
  const [from, setFrom] = useState<string | null>(null);
  const here = from ?? startId;
  return (
    <Stack gap="xs">
      {from ? (
        <Group gap="xs">
          <Text size="xs" c="dimmed">Asking from {nodeName({ id: from, label: kindOf(from), name: null, count: 0 })}</Text>
          <Button size="compact-xs" variant="subtle" onClick={() => setFrom(null)}>Back to {label ?? 'the start'}</Button>
        </Group>
      ) : null}
      <Questions key={here} graphId={here} onPivot={onPivot} onAskFrom={(id) => { const ok = validNodeId(id); if (ok) setFrom(ok); }} />
    </Stack>
  );
};

/**
 * The analyst questions the data dictionary declares, run from this entity over the entity graph: pick a question or type one, see each
 * step's strongest connections with counts, open any entity in it as the next thing to investigate, or ask from it.
 */
export const AskGraph = ({ seed, onPivot }: { seed: EntitySeed; onPivot: (seed: EntitySeed) => void }) => {
  const profile = useSiemQuery('entityProfile', { body: { type: seed.type, value: seed.value } });
  return (
    <section aria-label="Ask the graph">
      <Panel title="Ask the graph">
        <QueryBoundary query={profile} isEmpty={(p) => validNodeId(p.graph_id) === null}
          empty={<EmptyState title="The graph does not know this entity yet" hint="It has no node in the entity graph, so no question can start from it." />}>
          {(p) => <AskFrom key={`${seed.type}:${seed.value}`} startId={p.graph_id as string} label={seed.value} onPivot={onPivot} />}
        </QueryBoundary>
      </Panel>
    </section>
  );
};

import React, { useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Group, Slider, Stack, Table, Text, Title, UnstyledButton } from '@mantine/core';
import type { Dictionary } from '@/lib/dictionary/ddv2';
import { vocabularyModel } from '@/lib/dictionary/ddv2';
import type { VocabGraph } from '@/lib/dictionary/ddv2';
import type { Lens } from '@/lib/vectis-kit/entity-graph/lens';
import { EntityGraph } from '@/lib/vectis-kit/entity-graph/EntityGraph';

/**
 * The graph vocabulary (graphContract): node labels and the entities that carry them, the declared edge types between
 * labels, and the open edge families whose type comes from the data. Every value is rendered as text; a family's
 * pattern is shown, never evaluated.
 */
// Labels and open-family hubs differ in colour and shape; the legend says which is which.
const LENS: Lens = { labels: { 'Graph label': { color: '#0173B2', symbol: 'circle' }, 'Open edge family': { color: '#7A7A7A', symbol: 'diamond' } } };

export const RelationshipsView = ({ dictionary, label, onLabel, onOpenEntity }: {
  dictionary: Dictionary; label: string | null; onLabel: (l: string | null) => void; onOpenEntity: (entity: string) => void;
}) => {
  const model = useMemo(() => vocabularyModel(dictionary), [dictionary]);
  if (!dictionary.hasContract || (dictionary.labels.length === 0 && dictionary.edges.length === 0 && dictionary.families.length === 0)) {
    return <Text p="md" c="dimmed" data-testid="no-contract">This dictionary does not declare a graph vocabulary.</Text>;
  }
  const selected = label && dictionary.labels.some((l) => l.name === label) ? label : null;
  return (
    <Stack gap="xl" data-testid="dictionary-relationships">
      <section aria-labelledby="rel-graph">
        <Title order={4} id="rel-graph" mb={4}>Labels with declared relationships</Title>
        <Text size="sm" c="dimmed" mb="xs">
          {model.declared.nodes.filter((n) => n.label === 'Graph label').length} labels joined by {dictionary.edges.filter((e) => !e.dangling).length} declared edge types (solid arrows, listed below).
          {model.declared.open.size ? ' Dashed lines are open edge families: the edge type comes from the data, and a diamond stands for a family.' : ''}
        </Text>
        {dictionary.notes.filter((n) => /edge type/.test(n)).map((n) => <Alert key={n} color="yellow" variant="light" mb="xs">{n}</Alert>)}
        <Graph g={model.declared} selected={selected} onLabel={onLabel} layout="circular" caption="Dictionary labels with declared edges" height={620} />
      </section>

      {model.openOnly.map(({ family, graph }) => {
        const bridges = graph.nodes.filter((n) => n.label === 'Graph label' && model.declared.nodes.some((d) => d.id === n.id)).map((n) => n.id);
        return (
          <section key={family.name} aria-labelledby={`rel-open-${family.name}`} data-testid="open-only-cluster">
            <Title order={4} id={`rel-open-${family.name}`} mb={4}>Labels related only through the open edge family {family.name}</Title>
            <Text size="sm" c="dimmed" mb="xs">
              No edge type between these labels is declared. The family allows any type matching the pattern below, between any of them.
              {family.note ? ` ${family.note}` : ''}
              {bridges.length ? ` ${bridges.join(', ')} also ${bridges.length === 1 ? 'has' : 'have'} declared edges in the graph above; that is the only place this cluster touches it.` : ' None of these labels has a declared edge to the graph above.'}
            </Text>
            <Graph g={graph} selected={selected} onLabel={onLabel} layout="force" repulsion={900} caption={`Labels related through the open edge family ${family.name}`} height={560} />
          </section>
        );
      })}

      <section aria-labelledby="rel-isolated" data-testid="isolated-labels">
        <Title order={4} id="rel-isolated" mb={4}>Labels with no declared relationships</Title>
        {model.isolated.length ? (
          <>
            <Group gap="xs" mb={4}>{model.isolated.map((l) => <Badge key={l} variant="light" color="gray" radius="sm" tt="none">{l}</Badge>)}</Group>
            <Text size="sm" c="dimmed">The dictionary lists {model.isolated.length === 1 ? 'this label' : 'these labels'} but declares no edge type or open edge family for {model.isolated.length === 1 ? 'it' : 'them'}, so the ETL writes {model.isolated.length === 1 ? 'it' : 'them'} as nodes with no declared edges.</Text>
          </>
        ) : <Text size="sm" c="dimmed">Every label appears in a declared edge or an open edge family.</Text>}
      </section>

      <section aria-labelledby="rel-labels">
        <Title order={4} id="rel-labels" mb="xs">Labels and the entities that carry them</Title>
        <Table.ScrollContainer minWidth={480} type="native">
          <Table striped withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Label</Table.Th><Table.Th>Entities</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {dictionary.labels.map((l) => (
                <Table.Tr key={l.name} data-testid="label-row" bg={l.name === selected ? 'var(--mantine-color-grape-light)' : undefined}>
                  <Table.Td>
                    <UnstyledButton onClick={() => onLabel(l.name === selected ? null : l.name)} aria-pressed={l.name === selected} aria-label={`Highlight label ${l.name} in the graph`}>
                      <Text size="sm" fw={600}>{l.name}</Text>
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {l.entities.length ? l.entities.map((e) => <Anchor key={e} component="button" type="button" size="sm" ff="monospace" onClick={() => onOpenEntity(e)}>{e}</Anchor>) : <Text size="sm" c="dimmed">none</Text>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </section>

      <section aria-labelledby="rel-edges">
        <Title order={4} id="rel-edges" mb="xs">Edge types</Title>
        <Table.ScrollContainer minWidth={480} type="native">
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Edge type</Table.Th><Table.Th>From</Table.Th><Table.Th>To</Table.Th><Table.Th>Relation</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {dictionary.edges.map((e, i) => (
                <Table.Tr key={`${e.type}-${e.from}-${e.to}-${i}`} data-testid="edge-row">
                  <Table.Td><Text size="sm" ff="monospace">{e.type}</Text></Table.Td>
                  <Table.Td>{e.from}</Table.Td>
                  <Table.Td>{e.to}</Table.Td>
                  <Table.Td>{e.relation}{e.dangling ? <Badge ml="xs" color="red" variant="light" size="xs">undeclared label</Badge> : null}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </section>

      <section aria-labelledby="rel-families">
        <Title order={4} id="rel-families" mb={4}>Open edge families</Title>
        <Text size="sm" c="dimmed" mb="xs">Edge types that come from the data. Any type matching the pattern is allowed between the listed labels.</Text>
        {dictionary.families.length === 0 ? <Text size="sm" c="dimmed">None declared.</Text> : null}
        <Stack gap="sm">
          {dictionary.families.map((f) => (
            <div key={f.name} className="rounded border border-base-light p-3 bg-base-max" data-testid="family">
              <Group gap="xs" mb={4}><Text fw={600}>{f.name}</Text>{f.relation ? <Badge variant="light">{f.relation}</Badge> : null}</Group>
              <Text size="sm" ff="monospace" mb={4} style={{ overflowWrap: 'anywhere' }}>{f.pattern}</Text>
              <Text size="sm"><Text span fw={600}>From: </Text>{f.from.join(', ') || 'none'}</Text>
              <Text size="sm"><Text span fw={600}>To: </Text>{f.to.join(', ') || 'none'}</Text>
              {f.note ? <Text size="sm" c="dimmed" mt={4}>{f.note}</Text> : null}
            </div>
          ))}
        </Stack>
      </section>
      {dictionary.notes.filter((n) => !/edge type/.test(n)).map((n) => <Text key={n} size="xs" c="dimmed" data-testid="dictionary-note">{n}</Text>)}
    </Stack>
  );
};

const SPACING_MIN = 1;
const SPACING_MAX = 10;
const SPACING_DEFAULT = 4;

const Graph = ({ g, selected, onLabel, layout, repulsion, caption, height }: {
  g: VocabGraph; selected: string | null; onLabel: (l: string | null) => void; layout: 'force' | 'circular'; repulsion?: number; caption: string; height: number;
}) => {
  // Spreads the force layout so hub labels do not overlap; the ring layout does not need it.
  const [spacing, setSpacing] = useState(SPACING_DEFAULT);
  const force = layout === 'force';
  return (
    <>
      {force ? (
        <Group gap="sm" mb={6} align="center" wrap="nowrap" data-testid="graph-spacing">
          <Text size="xs" c="dimmed" aria-hidden style={{ whiteSpace: 'nowrap' }}>Spread labels out</Text>
          <Slider w={220} size="sm" min={SPACING_MIN} max={SPACING_MAX} step={1} value={spacing} onChange={setSpacing}
            thumbLabel="Spread labels out" label={null} />
        </Group>
      ) : null}
      <EntityGraph
        nodes={g.nodes} edges={g.edges} lens={LENS} selectedId={selected} height={height} label={caption}
        layout={layout} dashedEdgeTypes={g.open} edgeLabels={false} legend={layout !== 'circular'}
        {...(force ? { repulsion: (repulsion ?? 900) * (0.4 + spacing * 0.35), edgeLength: [50 + spacing * 25, 120 + spacing * 45] as [number, number] } : {})}
        onNodeClick={(n) => { if (!n.id.startsWith('open:')) onLabel(n.id); }}
      />
    </>
  );
};

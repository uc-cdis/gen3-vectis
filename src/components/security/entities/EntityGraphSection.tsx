import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { IconArrowsMaximize } from '@tabler/icons-react';
import { useSiemMutation, useSiemQuery } from '@/lib/vectis-kit/api/hooks';
import { ApiError } from '@/lib/vectis-kit/api';
import type { EntitySeed, GraphEdge, GraphNode, GraphTraverseResponse } from '@/lib/vectis-kit/spec';
import { CopyValue, FactList } from '@/lib/vectis-kit/entity-card/blocks';
import { safeText } from '@/lib/safe-text';
import { EntityGraph } from '@/lib/vectis-kit/entity-graph/EntityGraph';
import { MAX_GRAPH_HOPS, MAX_GRAPH_NODES, mergeGraph } from '@/lib/vectis-kit/entity-graph/graphModel';
import { nodeTitleText } from '@/lib/vectis-kit/entity-graph/lens';
import type { Lens } from '@/lib/vectis-kit/entity-graph/lens';
import { useSecurity } from '../context';
import { EmptyState, ErrorState, QueryBoundary, Unmeasured } from '@/lib/vectis-kit/ui/primitives';
import { seedFromGraphNode, validNodeId } from './entityKeys';
import { ExpandableText } from '@/lib/vectis-kit/ui/ExpandableText';

const HOPS = Array.from({ length: MAX_GRAPH_HOPS }, (_, i) => ({ value: String(i + 1), label: `${i + 1} hop${i ? 's' : ''}` }));
const LIMITS = [50, 100, 200, 500].map((n) => ({ value: String(n), label: `up to ${n} nodes` }));
/** Expanding a node adds its direct neighbours. */
const EXPAND_HOPS = 1;

type Selection = { kind: 'node'; node: GraphNode } | { kind: 'edge'; edge: GraphEdge } | null;

/**
 * The bounded neighbourhood of an entity, starting at the graph id the profile reports (`graph_id`).
 * Without one (the entity has no node) the section says so; nothing is guessed.
 * Clicking a node or edge selects it; Expand (or double-click) fetches that node's neighbours and merges them in.
 */
export const EntityGraphSection = ({ seed, graphId }: { seed: EntitySeed; graphId: string | null | undefined }) => {
  const { openEntity } = useSecurity();
  const startId = validNodeId(graphId);
  // One hop is what this entity did and hit; a second hop adds every other address that touched the same things.
  const [hops, setHops] = useState('1');
  const [limit, setLimit] = useState('100');
  const [selection, setSelection] = useState<Selection>(null);
  const [expansion, setExpansion] = useState<{ key: string; extras: GraphTraverseResponse[] }>({ key: '', extras: [] });
  const [expanding, setExpanding] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [expandError, setExpandError] = useState<ApiError | null>(null);
  const expand = useSiemMutation('graph');

  const base = useSiemQuery('graph', startId ? { body: { start_id: startId, max_hops: Number(hops), limit: Number(limit) } } : null);
  const baseKey = `${startId}|${hops}|${limit}`;

  const baseData = base.data;
  const merged = useMemo(() => {
    if (!baseData) return null;
    const extras = expansion.key === baseKey ? expansion.extras : [];
    let g = mergeGraph({ nodes: [], edges: [] }, baseData);
    for (const x of extras) g = mergeGraph(g, x);
    return { ...g, truncated: g.truncated || baseData.truncated || extras.some((x) => x.truncated) };
  }, [baseData, expansion, baseKey]);

  const onExpand = useCallback(async (node: GraphNode) => {
    setExpandError(null);
    setExpanding(true);
    try {
      const more = await expand({ body: { start_id: node.id, max_hops: EXPAND_HOPS, limit: Math.min(Number(limit), MAX_GRAPH_NODES) } });
      setExpansion((cur) => ({ key: baseKey, extras: [...(cur.key === baseKey ? cur.extras : []), more] }));
    } catch (e) {
      setExpandError(e instanceof ApiError ? e : new ApiError(0, 'Could not expand this node.', 'graph'));
    } finally {
      setExpanding(false);
    }
  }, [expand, limit, baseKey]);

  if (!startId) return <Unmeasured reason="The graph needs the entity's tenant, which comes from its alert groups. None are known for this entity, or its value cannot be used as a graph id." />;

  const titleById = (id: string) => {
    const n = merged?.nodes.find((x) => x.id === id);
    return n ? nodeTitleText(n, securityLens) : safeText(id, 80);
  };

  const graphView = (height: number, big: boolean) => merged ? (
    <EntityGraph
      nodes={merged.nodes}
      edges={merged.edges}
      lens={securityLens}
      truncated={merged.truncated}
      selectedId={selection?.kind === 'node' ? selection.node.id : null}
      label={`Graph neighbourhood of ${safeText(seed.value, 80)}`}
      height={height}
      {...(big ? { repulsion: 420, edgeLength: [90, 220] as [number, number] } : {})}
      onNodeClick={(node) => setSelection({ kind: 'node', node })}
      onEdgeClick={(edge) => setSelection({ kind: 'edge', edge })}
      onExpand={(node) => { setSelection({ kind: 'node', node }); void onExpand(node); }}
    />
  ) : null;

  return (
    <Stack gap="sm" data-testid="entity-graph-section">
      <Group gap="sm" align="flex-end">
        <Select label="Depth" size="xs" w={120} data={HOPS} value={hops} onChange={(v) => v && setHops(v)} allowDeselect={false} />
        <Select label="Size" size="xs" w={160} data={LIMITS} value={limit} onChange={(v) => v && setLimit(v)} allowDeselect={false} />
        <Text size="xs" c="dimmed">1 hop shows what it did and hit. 2 hops adds the other addresses that did the same things. Expanding a node adds its direct neighbours.</Text>
      </Group>
      <QueryBoundary query={base} isEmpty={(d) => d.nodes.length === 0} empty={<EmptyState title="No graph neighbours found for this entity" />}>
        {() => merged ? (
          <>
            <Group justify="flex-end" mb={-4}>
              <Button size="compact-xs" variant="default" leftSection={<IconArrowsMaximize size={14} />} onClick={() => setEnlarged(true)}>Enlarge</Button>
            </Group>
            {graphView(460, false)}
            <Modal opened={enlarged} onClose={() => setEnlarged(false)} fullScreen title={`Graph neighbourhood of ${safeText(seed.value, 80)}`}>
              {enlarged ? graphView(Math.max(480, Math.round(window.innerHeight * 0.78)), true) : null}
            </Modal>
            {expandError ? <ErrorState error={expandError} /> : null}
            {expanding ? <Text size="sm" c="dimmed" aria-live="polite">Expanding...</Text> : null}
            {selection?.kind === 'node' ? (
              <Alert variant="light" color="gray" title={`${safeText(selection.node.label, 60)}: ${nodeTitleText(selection.node, securityLens)}`} data-testid="graph-selection">
                <Stack gap="xs">
                  <FactList facts={[
                    { label: 'Id', value: <CopyValue value={selection.node.id} what="node id" /> },
                    ...Object.entries(selection.node.properties ?? {}).slice(0, 12).map(([k, v]) => ({ label: safeText(k, 40), value: <ExpandableText value={safeText(v, Number.MAX_SAFE_INTEGER)} previewChars={160} size="sm" label={`property ${safeText(k, 40)}`} /> })),
                  ]} />
                  <Group gap="xs">
                    <Button size="compact-xs" variant="default" loading={expanding} onClick={() => void onExpand(selection.node)}>Expand neighbours</Button>
                    {(() => {
                      const s = seedFromGraphNode(selection.node);
                      return s ? <Button size="compact-xs" variant="default" onClick={() => openEntity(s)}>Open as entity</Button> : null;
                    })()}
                  </Group>
                </Stack>
              </Alert>
            ) : null}
            {selection?.kind === 'edge' ? (
              <Alert variant="light" color="gray" title={`Relation: ${safeText(selection.edge.edge_type, 80)}`} data-testid="graph-selection">
                <FactList facts={[
                  { label: 'From', value: titleById(selection.edge.src_id) },
                  { label: 'Relation', value: safeText(selection.edge.edge_type, 80) },
                  { label: 'To', value: titleById(selection.edge.dst_id) },
                ]} />
              </Alert>
            ) : null}
          </>
        ) : null}
      </QueryBoundary>
    </Stack>
  );
};

/**
 * How the security graph's node kinds look. The keys are the real kinds of the dictionary's graph contract
 * (vectis_dictionary/commons/vectisprod/graph_contract.json, `labels`). The gateway sends each node's display text in
 * `properties.name`; if it is missing the lens defaults and then the id are used (see `nodeTitle`). Kinds not listed
 * still get a stable colour and shape from their name and the same title rule.
 */
export const securityLens: Lens = {
  labels: {
    IpAddress: { color: '#0173B2', symbol: 'circle', titleProperty: 'name' },
    Asn: { color: '#029E73', symbol: 'diamond', titleProperty: 'name' },
    UserAgent: { color: '#CC78BC', symbol: 'rect', titleProperty: 'name' },
    JA4Fingerprint: { color: '#CA9161', symbol: 'triangle', titleProperty: 'name' },
    RequestSignature: { color: '#56B4E9', symbol: 'roundRect', titleProperty: 'name' },
    LogSource: { titleProperty: 'name' },
    Country: { titleProperty: 'name' },
    Finding: { titleProperty: 'name' },
    Host: { titleProperty: 'name' },
    Indicator: { color: '#D55E00', symbol: 'pin', titleProperty: 'name' },
    Technique: { color: '#7A7A7A', symbol: 'rect', titleProperty: 'name' },
  },
};

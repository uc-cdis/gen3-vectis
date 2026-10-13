import React, { useMemo } from 'react';
import { Button, Group, Stack, Text, Title } from '@mantine/core';
import type { MRT_ColumnDef } from 'mantine-react-table-open';
import type { GraphEdge, GraphNode } from '../spec';
import { SimpleTable } from '../entity-card/blocks';
import { safeText } from '@/lib/safe-text';
import type { GraphData } from './graphModel';
import type { Lens } from './lens';
import { nodeTitle } from './lens';

interface NodeRow { id: string; kind: string; title: string; properties: string; node: GraphNode }
interface EdgeRow { key: string; from: string; relation: string; to: string; edge: GraphEdge }

interface GraphTableProps extends GraphData {
  lens?: Lens;
  onNodeClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  onExpand?: (node: GraphNode) => void;
}

/** The text alternative to the canvas: every node and every edge, with the same actions, usable by keyboard. */
export const GraphTable = ({ nodes, edges, lens, onNodeClick, onEdgeClick, onExpand }: GraphTableProps) => {
  const titleOf = useMemo(() => new Map(nodes.map((n) => [n.id, nodeTitle(n, lens)])), [nodes, lens]);

  const nodeRows = useMemo<NodeRow[]>(
    () => nodes.map((n) => ({
      id: safeText(n.id, 120),
      kind: safeText(n.label, 60),
      title: safeText(nodeTitle(n, lens), 80),
      properties: safeText(n.properties ?? {}, 160),
      node: n,
    })),
    [nodes, lens],
  );
  const edgeRows = useMemo<EdgeRow[]>(
    () => edges.map((e) => ({
      key: JSON.stringify([e.src_id, e.edge_type, e.dst_id]),
      from: safeText(titleOf.get(e.src_id) ?? e.src_id, 80),
      relation: safeText(e.edge_type, 60),
      to: safeText(titleOf.get(e.dst_id) ?? e.dst_id, 80),
      edge: e,
    })),
    [edges, titleOf],
  );

  const nodeColumns = useMemo<MRT_ColumnDef<NodeRow>[]>(() => [
    { accessorKey: 'kind', header: 'Kind', size: 110 },
    { accessorKey: 'title', header: 'Title' },
    { accessorKey: 'id', header: 'Id' },
    { accessorKey: 'properties', header: 'Properties' },
    {
      id: 'actions', header: 'Actions', enableSorting: false,
      Cell: ({ row }) => (
        <Group gap={4} wrap="nowrap">
          <Button size="compact-xs" variant="default" aria-label={`Select ${row.original.title}`} onClick={() => onNodeClick?.(row.original.node)}>Select</Button>
          {onExpand ? <Button size="compact-xs" variant="default" aria-label={`Expand ${row.original.title}`} onClick={() => onExpand(row.original.node)}>Expand</Button> : null}
        </Group>
      ),
    },
  ], [onNodeClick, onExpand]);
  const edgeColumns = useMemo<MRT_ColumnDef<EdgeRow>[]>(() => [
    { accessorKey: 'from', header: 'From' },
    { accessorKey: 'relation', header: 'Relation', size: 130 },
    { accessorKey: 'to', header: 'To' },
    {
      id: 'actions', header: 'Actions', enableSorting: false,
      Cell: ({ row }) => (
        <Button size="compact-xs" variant="default" aria-label={`Select edge ${row.original.relation} from ${row.original.from} to ${row.original.to}`} onClick={() => onEdgeClick?.(row.original.edge)}>Select</Button>
      ),
    },
  ], [onEdgeClick]);

  return (
    <Stack gap="md" data-testid="graph-table">
      <div>
        <Title order={6} mb={4}>Nodes ({nodes.length})</Title>
        {nodes.length ? <SimpleTable columns={nodeColumns} data={nodeRows} caption="Graph nodes" pageSize={10} /> : <Text size="sm" c="dimmed">No nodes.</Text>}
      </div>
      <div>
        <Title order={6} mb={4}>Edges ({edges.length})</Title>
        {edges.length ? <SimpleTable columns={edgeColumns} data={edgeRows} caption="Graph edges" pageSize={10} /> : <Text size="sm" c="dimmed">No edges.</Text>}
      </div>
    </Stack>
  );
};

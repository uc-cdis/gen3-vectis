import type { GraphEdge, GraphNode } from '../spec';
import type { Lens } from './lens';
import { nodeTitle } from './lens';
import { safeText } from '@/lib/safe-text';

/** The contract's bounds (contract.py): a graph never holds more than this, whatever the server returns. */
export const MAX_GRAPH_NODES = 500;
export const MAX_GRAPH_HOPS = 3;

export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }
interface MergedGraph extends GraphData {
  /** True when nodes were dropped to stay within the cap. */
  truncated: boolean;
}

/** A stable identity for an edge. JSON keeps ids that contain any character from colliding. */
export const edgeKey = (e: GraphEdge): string => JSON.stringify([e.src_id, e.edge_type, e.dst_id]);

/**
 * Merge `incoming` into `base`. Nodes and edges are deduplicated (the first copy of a node wins, so the
 * order, and therefore the layout, of what is already on screen never changes), edges whose endpoints are
 * missing are dropped, and the node count is capped. Pure: neither input is modified.
 */
export function mergeGraph(base: GraphData, incoming: GraphData, cap: number = MAX_GRAPH_NODES): MergedGraph {
  const limit = Math.max(0, Math.min(cap, MAX_GRAPH_NODES));
  const nodes: GraphNode[] = [];
  const ids = new Set<string>();
  let truncated = false;
  for (const n of [...base.nodes, ...incoming.nodes]) {
    if (ids.has(n.id)) continue;
    if (nodes.length >= limit) { truncated = true; continue; }
    ids.add(n.id);
    nodes.push(n);
  }
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const e of [...base.edges, ...incoming.edges]) {
    const k = edgeKey(e);
    if (seen.has(k) || !ids.has(e.src_id) || !ids.has(e.dst_id)) continue;
    seen.add(k);
    edges.push(e);
  }
  return { nodes, edges, truncated };
}

type GraphClick = { kind: 'node'; node: GraphNode } | { kind: 'edge'; edge: GraphEdge } | null;

/** Resolve an ECharts click event to the node or edge it was on. Unknown ids resolve to nothing. */
export function resolveGraphClick(params: { dataType?: unknown; data?: unknown }, graph: GraphData): GraphClick {
  const data = (params.data ?? {}) as { id?: unknown };
  if (typeof data.id !== 'string') return null;
  if (params.dataType === 'node') {
    const node = graph.nodes.find((n) => n.id === data.id);
    return node ? { kind: 'node', node } : null;
  }
  if (params.dataType === 'edge') {
    const edge = graph.edges.find((e) => edgeKey(e) === data.id);
    return edge ? { kind: 'edge', edge } : null;
  }
  return null;
}

/** Ids of nodes whose title, id, label or property values contain `query` (case-insensitive). Empty query matches nothing. */
export function matchNodes(nodes: readonly GraphNode[], query: string, lens?: Lens): Set<string> {
  const q = query.trim().toLowerCase();
  const out = new Set<string>();
  if (q === '') return out;
  for (const n of nodes) {
    const hay = [nodeTitle(n, lens), n.id, n.label, ...Object.values(n.properties ?? {}).map((v) => safeText(v, 200))];
    if (hay.some((h) => h.toLowerCase().includes(q))) out.add(n.id);
  }
  return out;
}

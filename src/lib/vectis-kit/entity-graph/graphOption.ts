import type { ReactEChartsProps } from '@gen3/frontend';
import type { GraphNode } from '../spec';
import { escapeHtml, neutraliseBraces, safeText, truncateText } from '@/lib/safe-text';
import type { GraphData } from './graphModel';
import { MAX_GRAPH_NODES, edgeKey, mergeGraph } from './graphModel';
import type { Lens } from './lens';
import { displayId, nodeTitle, styleFor } from './lens';

type EChartsOption = ReactEChartsProps['option'];

export const LABEL_MAX_CHARS = 28;
const EDGE_LABEL_MAX_CHARS = 24;

export interface BuildOptions {
  lens?: Lens;
  /** Node ids to emphasise (search results); everything else is dimmed. */
  highlight?: ReadonlySet<string>;
  /** The currently selected node, drawn with a heavy outline. */
  selectedId?: string | null;
  /** Previous layout positions by node id, so merged graphs keep what is already placed. */
  positions?: Readonly<Record<string, readonly [number, number]>>;
  cap?: number;
  /** 'circular' places every node on a ring (no overlap, deterministic); default is the force layout. */
  layout?: 'force' | 'circular';
  /** Edge types drawn dashed (for example, open families that stand for many possible edge types). */
  dashedEdgeTypes?: ReadonlySet<string>;
  /** Draw the edge type on each edge. Default true. */
  edgeLabels?: boolean;
  /** Show the legend by node kind. Default true. */
  legend?: boolean;
  /** Force layout repulsion. Default 220. */
  repulsion?: number;
  /** Force layout edge length range. Default [60, 140]. */
  edgeLength?: [number, number];
}

interface GraphOptionResult extends GraphData {
  option: EChartsOption;
  /** Distinct node labels, in first-seen order. These are the legend entries and the categories. */
  categories: string[];
  /** True when the cap dropped nodes. */
  truncated: boolean;
}

/** Text safe for a canvas label: printable, short, and with no `{style|...}` rich-text markup. */
export const labelText = (s: string, max: number = LABEL_MAX_CHARS): string => neutraliseBraces(safeText(s, max));

/** Tooltip content. This is the only HTML ECharts renders, so every part is escaped. */
export function tooltipHtml(params: { dataType?: unknown; data?: unknown; name?: unknown }): string {
  const d = (params.data ?? {}) as { kind?: unknown; title?: unknown; fullId?: unknown; relation?: unknown; from?: unknown; to?: unknown };
  if (params.dataType === 'edge') {
    return `${escapeHtml(safeText(d.relation, 60))}<br/>${escapeHtml(safeText(d.from, 60))} &rarr; ${escapeHtml(safeText(d.to, 60))}`;
  }
  return `<b>${escapeHtml(safeText(d.kind, 60))}</b><br/>${escapeHtml(safeText(d.title, 100))}<br/>${escapeHtml(safeText(d.fullId, 120))}`;
}

/**
 * Convert nodes and edges to an ECharts `graph` series (force layout, draggable, roam), driven by the lens.
 * Pure. Duplicate ids are removed, the node count is capped, edges to missing nodes are dropped, every
 * string that reaches the chart is truncated and neutralised, and node kinds differ by shape as well as colour.
 */
export function buildGraphOption(input: GraphData, opts: BuildOptions = {}): GraphOptionResult {
  const { lens, highlight, selectedId, positions, layout = 'force', dashedEdgeTypes, edgeLabels = true, legend = true, repulsion = 220, edgeLength = [60, 140] } = opts;
  const merged = mergeGraph({ nodes: [], edges: [] }, input, opts.cap ?? MAX_GRAPH_NODES);
  const { nodes, edges } = merged;

  const categories: string[] = [];
  for (const n of nodes) if (!categories.includes(n.label)) categories.push(n.label);

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.src_id, (degree.get(e.src_id) ?? 0) + 1);
    degree.set(e.dst_id, (degree.get(e.dst_id) ?? 0) + 1);
  }
  const dimming = highlight !== undefined && highlight.size > 0;
  const byId = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

  const data = nodes.map((n) => {
    const style = styleFor(lens, n.label);
    const title = nodeTitle(n, lens);
    const hit = dimming && highlight.has(n.id);
    const selected = selectedId === n.id;
    const pos = positions && Object.hasOwn(positions, n.id) ? positions[n.id] : undefined;
    return {
      id: n.id,
      name: n.id,
      category: categories.indexOf(n.label),
      symbol: style.symbol,
      symbolSize: Math.min(44, 18 + 3 * (degree.get(n.id) ?? 0)) + (hit ? 8 : 0),
      itemStyle: {
        color: style.color,
        opacity: dimming && !hit ? 0.25 : 1,
        borderColor: hit || selected ? '#111111' : '#ffffff',
        borderWidth: hit || selected ? 3 : 1,
      },
      label: { show: !dimming || hit, formatter: labelText(title) },
      ...(pos ? { x: pos[0], y: pos[1] } : {}),
      // read back by the tooltip formatter and the click handler; text only
      kind: n.label,
      title: truncateText(title, 100),
      fullId: truncateText(n.id, 120),
    };
  });

  const links = edges.map((e) => ({
    id: edgeKey(e),
    source: e.src_id,
    target: e.dst_id,
    label: { show: edgeLabels, formatter: labelText(e.edge_type, EDGE_LABEL_MAX_CHARS) },
    lineStyle: { curveness: 0.12, opacity: dimming ? 0.35 : 0.8, ...(dashedEdgeTypes?.has(e.edge_type) ? { type: 'dashed' as const, width: 2 } : {}) },
    relation: truncateText(e.edge_type, 60),
    from: truncateText(nodeTitle(byId.get(e.src_id) as GraphNode, lens) || displayId(e.src_id), 60),
    to: truncateText(nodeTitle(byId.get(e.dst_id) as GraphNode, lens) || displayId(e.dst_id), 60),
  }));

  const option: EChartsOption = {
    aria: { enabled: true },
    animation: true,
    legend: { show: legend, type: 'scroll', top: 0, data: categories.map((c) => labelText(c, 40)) },
    tooltip: { trigger: 'item', confine: true, formatter: (p: unknown) => tooltipHtml(p as Parameters<typeof tooltipHtml>[0]) },
    series: [
      {
        type: 'graph',
        layout,
        ...(layout === 'circular' ? { circular: { rotateLabel: true }, zoom: 0.78 } : {}),
        roam: true,
        draggable: true,
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 6,
        categories: categories.map((c) => ({ name: labelText(c, 40), symbol: styleFor(lens, c).symbol, itemStyle: { color: styleFor(lens, c).color } })),
        force: { repulsion, edgeLength, gravity: 0.08, layoutAnimation: true },
        label: { show: true, position: layout === 'circular' ? 'right' : 'bottom', fontSize: 11 },
        edgeLabel: { show: edgeLabels, fontSize: 10 },
        emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
        data,
        links,
      },
    ],
  };
  return { option, nodes, edges, categories, truncated: merged.truncated };
}

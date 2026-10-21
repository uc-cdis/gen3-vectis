import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, Switch, Text, TextInput } from '@mantine/core';
import { IconDownload, IconSearch } from '@tabler/icons-react';
import type { ReactEChartsProps } from '@gen3/frontend';
import { ReactECharts } from '@gen3/frontend';
import type { GraphEdge, GraphNode } from '../spec';
import { GraphTable } from './GraphTable';
import { matchNodes, resolveGraphClick } from './graphModel';
import type { BuildOptions } from './graphOption';
import { buildGraphOption } from './graphOption';
import type { Lens } from './lens';

interface EntityGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  lens?: Lens;
  /** The server said it had more than it returned. Shown as "truncated". */
  truncated?: boolean;
  selectedId?: string | null;
  /** Pixel height of the canvas. */
  height?: number;
  /** Name for assistive technology, e.g. "Neighbourhood of 203.0.113.50". */
  label?: string;
  onNodeClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  /** Double-click on a node, or the Expand button in the table. */
  onExpand?: (node: GraphNode) => void;
  /** Layout and edge styling, passed to buildGraphOption. */
  layout?: BuildOptions['layout'];
  dashedEdgeTypes?: BuildOptions['dashedEdgeTypes'];
  edgeLabels?: boolean;
  legend?: boolean;
  repulsion?: number;
  edgeLength?: [number, number];
}

type ChartHandle = NonNullable<ReactEChartsProps['ref']>['current'];
type Pos = Record<string, readonly [number, number]>;
interface LayoutData { count: () => number; getId: (i: number) => string; getItemLayout: (i: number) => unknown }
interface SeriesModel { getData: () => LayoutData }
interface ChartWithModel { getModel?: () => { getSeriesByIndex?: (i: number) => SeriesModel | undefined } | undefined }

/** Read the positions the force layout has settled on so a merged graph can start from them. */
function readPositions(chart: unknown): Pos {
  const out: Pos = {};
  try {
    const data = (chart as ChartWithModel | undefined)?.getModel?.()?.getSeriesByIndex?.(0)?.getData();
    if (!data) return out;
    for (let i = 0; i < data.count(); i += 1) {
      const p = data.getItemLayout(i);
      if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1])) out[data.getId(i)] = [p[0], p[1]];
    }
  } catch {
    // layout not available yet: nodes simply start from the layout's own positions
  }
  return out;
}

/**
 * A bounded graph canvas on the framework's ReactECharts `graph` series. Domain-agnostic: all domain
 * knowledge is in the lens. Includes a legend by node kind, edge labels, search and highlight, PNG export,
 * and a table of nodes and edges as the text alternative.
 */
export const EntityGraph = ({ nodes, edges, lens, truncated, selectedId, height = 460, label = 'Entity graph', onNodeClick, onEdgeClick, onExpand, layout, dashedEdgeTypes, edgeLabels, legend, repulsion, edgeLength }: EntityGraphProps) => {
  const chartRef = useRef<ChartHandle>(null);
  const [query, setQuery] = useState('');
  const [asTable, setAsTable] = useState(false);

  const highlight = useMemo(() => matchNodes(nodes, query, lens), [nodes, query, lens]);

  // Layout positions, captured from the live chart whenever it finishes drawing and just before any action that
  // can change the graph, so nodes already on screen are re-sent at the same place when new ones are merged in.
  const positionsRef = useRef<Pos>({});
  const snapshot = useCallback(() => { positionsRef.current = readPositions(chartRef.current?.getEchartsInstance()); }, []);
  const built = useMemo(
    // Reading the ref during render is deliberate: the option must start from the layout as it is right now,
    // and a state update here would redraw on every layout frame.
    // oxlint-disable-next-line react/refs
    () => buildGraphOption({ nodes, edges }, { lens, highlight, selectedId, positions: positionsRef.current, layout, dashedEdgeTypes, edgeLabels, legend, repulsion, edgeLength }),
    [nodes, edges, lens, highlight, selectedId, layout, dashedEdgeTypes, edgeLabels, legend, repulsion, edgeLength],
  );

  // ReactECharts binds its event handlers once, so the handlers read the latest props through a ref.
  const latest = useRef({ graph: built, onNodeClick, onEdgeClick, onExpand });
  useEffect(() => { latest.current = { graph: built, onNodeClick, onEdgeClick, onExpand }; });
  const events = useMemo(() => ({
    click: (p: { dataType?: unknown; data?: unknown }) => {
      const cur = latest.current;
      const hit = resolveGraphClick(p, cur.graph);
      if (hit?.kind === 'node') cur.onNodeClick?.(hit.node);
      else if (hit?.kind === 'edge') cur.onEdgeClick?.(hit.edge);
    },
    dblclick: (p: { dataType?: unknown; data?: unknown }) => {
      const cur = latest.current;
      const hit = resolveGraphClick(p, cur.graph);
      if (hit?.kind === 'node') { snapshot(); cur.onExpand?.(hit.node); }
    },
    finished: () => snapshot(),
  }), [snapshot]);
  const expandFromTable = useCallback((n: GraphNode) => { snapshot(); onExpand?.(n); }, [snapshot, onExpand]);

  const exportPng = useCallback(() => {
    const url = chartRef.current?.getEchartsInstance()?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'entity-graph.png';
    a.click();
  }, []);

  return (
    <div data-testid="entity-graph">
      <Group justify="space-between" mb="xs" gap="xs">
        <TextInput
          size="xs"
          aria-label="Highlight nodes"
          placeholder="Highlight nodes"
          leftSection={<IconSearch size={14} />}
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.currentTarget.value)}
          description={query.trim() ? `${highlight.size} of ${built.nodes.length} nodes match` : undefined}
        />
        <Group gap="xs">
          <Switch size="xs" label="Show as table" checked={asTable} onChange={(e) => setAsTable(e.currentTarget.checked)} />
          <Button size="compact-xs" variant="default" leftSection={<IconDownload size={14} />} onClick={exportPng} disabled={asTable}>Export PNG</Button>
        </Group>
      </Group>
      {truncated || built.truncated ? (
        <Alert color="yellow" variant="light" mb="xs" aria-live="polite">
          Truncated: this graph shows at most {built.nodes.length} nodes and is not the whole neighbourhood. Narrow the search or expand a single node.
        </Alert>
      ) : null}
      {asTable ? (
        <GraphTable nodes={built.nodes} edges={built.edges} lens={lens} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} onExpand={onExpand ? expandFromTable : undefined} />
      ) : (
        <figure aria-label={label} style={{ height, margin: 0 }}>
          <ReactECharts ref={chartRef} option={built.option} theme="gen3" events={events} style={{ height }} />
        </figure>
      )}
      <Text size="xs" c="dimmed" mt={4}>
        {built.nodes.length} nodes, {built.edges.length} edges. Click selects, double-click expands. Use "Show as table" for a keyboard and screen-reader view.
      </Text>
    </div>
  );
};

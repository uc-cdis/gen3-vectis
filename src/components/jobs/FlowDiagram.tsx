import React from 'react';
import { Box, Code, Group, Paper, Text } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';

export type FlowStatus = 'success' | 'failure' | 'running' | 'neutral';
export interface FlowNode {
  key: string;
  kind: 'inputs' | 'step' | 'outputs';
  title: string;
  /** one line of detail (image, counts) */
  subtitle?: string;
  /** monospace line (argv) */
  code?: string;
  items?: string[];
  status?: FlowStatus;
  statusText?: string;
  /** DAG mode: keys of the nodes this one waits for. Present (even if empty) on every node of a DAG; absent in a linear flow. */
  deps?: string[];
}

const STYLE: Record<FlowStatus, { border: string; bg: string; fg: string }> = {
  success: { border: 'var(--mantine-color-green-5)', bg: 'var(--mantine-color-green-0)', fg: 'green.9' },
  failure: { border: 'var(--mantine-color-red-5)', bg: 'var(--mantine-color-red-0)', fg: 'red.9' },
  running: { border: 'var(--mantine-color-blue-5)', bg: 'var(--mantine-color-blue-0)', fg: 'blue.9' },
  neutral: { border: 'var(--mantine-color-gray-4)', bg: 'var(--mantine-color-white)', fg: 'dimmed' },
};

// ---------------------------------------------------------------- DAG layout (no library: fixed-size cards on a CSS grid + an SVG of arrows)
const CARD_W = 190;
const CARD_H = 74;
const COL_GAP = 56;
const ROW_GAP = 12;

interface DagPlacement { key: string; col: number; row: number }
/**
 * Layer = longest path from a node with no dependencies (so every arrow points to a later column). The returned array is
 * sorted by (layer, original order), which is a valid topological order: it is also the DOM order. Unknown dependencies are
 * ignored; a cycle (the server refuses those, this is only a guard) puts the remaining nodes in the last layer instead of looping.
 */
export function layoutDag(nodes: ReadonlyArray<Pick<FlowNode, 'key' | 'deps'>>): DagPlacement[] {
  const idx = new Map(nodes.map((n, i) => [n.key, i] as const));
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (k: string): number => {
    const known = layer.get(k);
    if (known !== undefined) return known;
    if (visiting.has(k)) return 0; // cycle guard
    visiting.add(k);
    const deps = (nodes[idx.get(k) as number].deps ?? []).filter((d) => idx.has(d) && d !== k);
    const v = deps.length ? 1 + Math.max(...deps.map(depth)) : 0;
    visiting.delete(k);
    layer.set(k, v);
    return v;
  };
  nodes.forEach((nd) => depth(nd.key));
  const order = nodes.map((n) => n.key).sort((a, b) => depth(a) - depth(b) || (idx.get(a) as number) - (idx.get(b) as number));
  const rows = new Map<number, number>();
  return order.map((key) => {
    const col = layer.get(key) as number;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    return { key, col, row };
  });
}

const DagFlow = ({ nodes, label }: { nodes: FlowNode[]; label: string }) => {
  const place = layoutDag(nodes);
  const byKey = new Map(nodes.map((n) => [n.key, n] as const));
  const pos = new Map(place.map((p) => [p.key, p] as const));
  const cols = Math.max(1, ...place.map((p) => p.col + 1));
  const rows = Math.max(1, ...place.map((p) => p.row + 1));
  const width = cols * CARD_W + (cols - 1) * COL_GAP;
  const height = rows * CARD_H + (rows - 1) * ROW_GAP;
  const x = (col: number) => col * (CARD_W + COL_GAP);
  const y = (row: number) => row * (CARD_H + ROW_GAP);
  const edges = place.flatMap((p) => (byKey.get(p.key)?.deps ?? []).filter((d) => pos.has(d) && d !== p.key).map((d) => ({ from: pos.get(d) as DagPlacement, to: p })));
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be keyboard-focusable (WCAG 2.1.1)
    <div role="region" aria-label={`${label} (scrollable)`} tabIndex={0} style={{ overflowX: 'auto', paddingBottom: 6 }}>
      <div style={{ position: 'relative', width, height }}>
        <svg aria-hidden="true" focusable="false" width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-testid="flow-edges">
          <defs>
            <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--mantine-color-gray-6)" /></marker>
          </defs>
          {edges.map((e, i) => {
            const x1 = x(e.from.col) + CARD_W, y1 = y(e.from.row) + CARD_H / 2;
            const x2 = x(e.to.col), y2 = y(e.to.row) + CARD_H / 2;
            const dx = Math.max(24, (x2 - x1) / 2);
            return <path key={i} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 1},${y2}`} fill="none" stroke="var(--mantine-color-gray-6)" strokeWidth={1.5} markerEnd="url(#flow-arrow)" data-edge={`${e.from.key}>${e.to.key}`} />;
          })}
        </svg>
        <ol aria-label={label} data-testid="flow" data-layout="dag" style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${cols}, ${CARD_W}px)`, gridAutoRows: `${CARD_H}px`, columnGap: COL_GAP, rowGap: ROW_GAP }}>
          {place.map((p) => {
            const n = byKey.get(p.key) as FlowNode;
            const st = STYLE[n.status ?? 'neutral'];
            const after = (n.deps ?? []).filter((d) => pos.has(d)).map((d) => byKey.get(d)?.title ?? d);
            return (
              <li key={n.key} data-node={n.kind} data-status={n.status ?? 'neutral'} data-step={n.key} aria-label={`${n.title}${n.statusText ? `: ${n.statusText}` : ''}${after.length ? `. After ${after.join(', ')}` : ''}`} style={{ gridColumn: p.col + 1, gridRow: p.row + 1, minWidth: 0 }}>
                <Paper withBorder radius="md" p="xs" h="100%" style={{ borderColor: st.border, background: st.bg, borderLeftWidth: 4, overflow: 'hidden' }}>
                  <Text size="sm" fw={700} truncate="end" title={n.title}>{n.title}</Text>
                  {n.subtitle ? <Text size="xs" c="dimmed" truncate="end" title={n.subtitle}>{n.subtitle}</Text> : null}
                  {n.statusText ? <Text size="xs" fw={600} mt={4} c={st.fg} truncate="end" data-testid="node-status">{n.statusText}</Text> : null}
                </Paper>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
};

/** The job as an ordered list of steps joined by arrows. A list in the DOM, so it reads in order for keyboards and screen readers. With `deps` on the nodes it is drawn as a DAG instead. */
export const FlowDiagram = ({ nodes, label }: { nodes: FlowNode[]; label: string }) => (nodes.some((n) => n.deps !== undefined) ? <DagFlow nodes={nodes} label={label} /> : <LinearFlow nodes={nodes} label={label} />);

const LinearFlow = ({ nodes, label }: { nodes: FlowNode[]; label: string }) => (
  <ol aria-label={label} data-testid="flow" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
    {nodes.map((n, i) => {
      const st = STYLE[n.status ?? 'neutral'];
      return (
        <Group component="li" key={n.key} gap={8} wrap="nowrap" align="stretch" data-node={n.kind} data-status={n.status ?? 'neutral'} style={{ flex: '0 1 auto', minWidth: 0 }}>
          {i > 0 ? <Group aria-hidden="true" c="dimmed" style={{ flex: '0 0 auto' }}><IconArrowRight size={18} /></Group> : null}
          <Paper withBorder radius="md" p="sm" style={{ borderColor: st.border, background: st.bg, borderLeftWidth: 4, minWidth: 150, maxWidth: 300 }}>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">{n.kind === 'step' ? n.title : n.kind === 'inputs' ? 'Inputs' : 'Outputs'}</Text>
            {n.kind !== 'step' && n.title ? <Text size="sm" fw={600}>{n.title}</Text> : null}
            {n.subtitle ? <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>{n.subtitle}</Text> : null}
            {n.code ? <Code block mt={4} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11 }}>{n.code}</Code> : null}
            {n.items?.length ? (
              <Box component="ul" m={0} mt={4} pl={16}>
                {n.items.map((it, j) => <li key={j}><Text span size="xs" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{it}</Text></li>)}
              </Box>
            ) : null}
            {n.statusText ? <Text size="xs" fw={600} mt={6} c={st.fg} data-testid="node-status">{n.statusText}</Text> : null}
          </Paper>
        </Group>
      );
    })}
  </ol>
);

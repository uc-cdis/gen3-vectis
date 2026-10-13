import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { GraphEdge, GraphNode } from '../spec';
import { edgeKey } from './graphModel';

vi.mock('@gen3/frontend', async (orig) => {
  const { mockCharts } = await import('@/components/security/entities/testUtils');
  return { ...(await orig<Record<string, unknown>>()), ...mockCharts() };
});
import { chartCalls, lastChart } from '@/components/security/entities/testUtils';
import { EntityGraph } from './EntityGraph';

const nodes: GraphNode[] = [
  { id: 't:IpAddress:198.51.100.1', label: 'IpAddress', properties: {} },
  { id: 't:Asn:AS1', label: 'Asn', properties: { org: 'Example <b>Hosting</b>' } },
];
const edges: GraphEdge[] = [{ src_id: nodes[0]!.id, dst_id: nodes[1]!.id, edge_type: 'in_network' }];
const mount = (p: Partial<React.ComponentProps<typeof EntityGraph>> = {}) =>
  render(<MantineProvider><EntityGraph nodes={nodes} edges={edges} {...p} /></MantineProvider>);

describe('EntityGraph', () => {
  it('passes a graph series to ReactECharts', () => {
    chartCalls.props.length = 0;
    mount();
    const series = (lastChart().option as { series: Array<{ type: string; data: unknown[] }> }).series[0]!;
    expect(series.type).toBe('graph');
    expect(series.data).toHaveLength(2);
  });

  it('calls onNodeClick for a node click and onEdgeClick for an edge click, using the latest handlers', () => {
    const onNodeClick = vi.fn();
    const onEdgeClick = vi.fn();
    mount({ onNodeClick, onEdgeClick });
    const { click } = lastChart().events!;
    click!({ dataType: 'node', data: { id: nodes[1]!.id } });
    click!({ dataType: 'edge', data: { id: edgeKey(edges[0]!) } });
    click!({ dataType: 'node', data: { id: 'unknown' } });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(nodes[1]);
    expect(onEdgeClick).toHaveBeenCalledWith(edges[0]);
  });

  it('expands on double-click', () => {
    const onExpand = vi.fn();
    mount({ onExpand });
    lastChart().events!.dblclick!({ dataType: 'node', data: { id: nodes[0]!.id } });
    expect(onExpand).toHaveBeenCalledWith(nodes[0]);
  });

  it('shows the node and edge table as a text alternative, with hostile text kept as text', async () => {
    const onExpand = vi.fn();
    const { container } = mount({ onExpand });
    await userEvent.click(screen.getByRole('switch', { name: 'Show as table' }));
    const table = screen.getByTestId('graph-table');
    expect(within(table).getByText('in_network')).toBeInTheDocument();
    expect(within(table).getByRole('table', { name: 'Graph nodes' })).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull(); // the <b> in the property is text, not an element
    await userEvent.click(within(table).getByRole('button', { name: /Expand 198\.51\.100\.1/ }));
    expect(onExpand).toHaveBeenCalledWith(nodes[0]);
  });

  it('says truncated when the server did', () => {
    mount({ truncated: true });
    expect(screen.getByText(/Truncated/)).toBeInTheDocument();
  });

  it('highlights matching nodes when searching', async () => {
    chartCalls.props.length = 0;
    mount();
    await userEvent.type(screen.getByLabelText('Highlight nodes'), 'AS1');
    const data = (lastChart().option as { series: Array<{ data: Array<{ id: string; itemStyle: { opacity: number } }> }> }).series[0]!.data;
    expect(data.find((d) => d.id === nodes[1]!.id)!.itemStyle.opacity).toBe(1);
    expect(data.find((d) => d.id === nodes[0]!.id)!.itemStyle.opacity).toBeLessThan(1);
    expect(screen.getByText('1 of 2 nodes match')).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../spec';
import { FIXTURES } from '../api/fixtureApi';
import type { GraphTraverseResponse } from '../spec';
import { MAX_GRAPH_NODES, edgeKey, matchNodes, mergeGraph, resolveGraphClick } from './graphModel';
import { LABEL_MAX_CHARS, buildGraphOption, tooltipHtml } from './graphOption';
import { displayId, nodeTitle, styleFor } from './lens';

const node = (id: string, label = 'Thing', properties: Record<string, unknown> = {}): GraphNode => ({ id, label, properties });
const edge = (a: string, b: string, t = 'rel'): GraphEdge => ({ src_id: a, dst_id: b, edge_type: t });
interface Item { id: string; category: number; symbol: string; label: { formatter: string }; itemStyle: { opacity: number; borderWidth: number }; title: string; x?: number; y?: number }
interface Link { label: { formatter: string } }
interface Series { data: Item[]; links: Link[]; categories: Array<{ name: string }> }
const series = (o: ReturnType<typeof buildGraphOption>) => (o.option.series as unknown as Series[])[0] as Series;

describe('buildGraphOption', () => {
  it('handles an empty graph', () => {
    const r = buildGraphOption({ nodes: [], edges: [] });
    expect(series(r).data).toEqual([]);
    expect(series(r).links).toEqual([]);
    expect(r.categories).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  it('draws a single node as a graph series with force layout, roam and drag', () => {
    const r = buildGraphOption({ nodes: [node('a:Thing:1')], edges: [] });
    const s = r.option.series as unknown as Array<Record<string, unknown>>;
    expect(s[0]).toMatchObject({ type: 'graph', layout: 'force', roam: true, draggable: true });
    expect(series(r).data).toHaveLength(1);
    expect(series(r).data[0]).toMatchObject({ id: 'a:Thing:1', category: 0 });
  });

  it('removes duplicate node ids and duplicate edges, and drops edges to unknown nodes', () => {
    const r = buildGraphOption({
      nodes: [node('a'), node('a'), node('b')],
      edges: [edge('a', 'b'), edge('a', 'b'), edge('a', 'missing')],
    });
    expect(series(r).data.map((d) => d.id)).toEqual(['a', 'b']);
    expect(series(r).links).toHaveLength(1);
  });

  it('caps the node count at 500 and reports truncation', () => {
    const nodes = Array.from({ length: 800 }, (_, i) => node(`n${i}`));
    const edges = [edge('n0', 'n799'), edge('n0', 'n1')];
    const r = buildGraphOption({ nodes, edges });
    expect(r.nodes).toHaveLength(MAX_GRAPH_NODES);
    expect(r.truncated).toBe(true);
    expect(series(r).links).toHaveLength(1); // n799 was cut, so its edge is gone
  });

  it('truncates long labels', () => {
    const long = 'x'.repeat(500);
    const r = buildGraphOption({ nodes: [node('id1', 'Thing', { name: long })], edges: [] });
    const label = series(r).data[0]!.label.formatter;
    expect(Array.from(label).length).toBeLessThanOrEqual(LABEL_MAX_CHARS);
    expect(label.endsWith('…')).toBe(true);
    expect(series(r).data[0]!.title.length).toBeLessThanOrEqual(100);
  });

  it('keeps hostile label text as text', () => {
    const evil = '<img src=x onerror=alert(1)>{bold|x}';
    const r = buildGraphOption({ nodes: [node('a', evil, { name: evil }), node('b')], edges: [edge('a', 'b', evil)] });
    const d = series(r).data[0]!;
    expect(d.label.formatter).toContain('<img src=x onerror=alert(1)'); // still the literal characters, truncated
    expect(d.label.formatter).not.toMatch(/[{}]/); // but no rich-text markup
    expect(series(r).links[0]!.label.formatter).not.toMatch(/[{}]/);
    const html = tooltipHtml({ dataType: 'node', data: d, name: 'a' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(tooltipHtml({ dataType: 'edge', data: series(r).links[0] })).not.toContain('<img');
  });

  it('gives each kind a legend entry, a category, and a shape as well as a colour', () => {
    const r = buildGraphOption({ nodes: [node('a', 'IpAddress'), node('b', 'Asn'), node('c', 'IpAddress')], edges: [edge('a', 'b', 'in_network')] });
    expect(r.categories).toEqual(['IpAddress', 'Asn']);
    expect(series(r).categories.map((c) => c.name)).toEqual(['IpAddress', 'Asn']);
    expect((r.option.legend as { data: string[] }).data).toEqual(['IpAddress', 'Asn']);
    expect(series(r).data[0]).toHaveProperty('symbol');
    expect((r.option.series as unknown as Array<{ edgeLabel: { show: boolean } }>)[0]!.edgeLabel.show).toBe(true);
    expect(series(r).links[0]!.label.formatter).toBe('in_network');
  });

  it('dims non-matching nodes and outlines matches when highlighting', () => {
    const r = buildGraphOption({ nodes: [node('a'), node('b')], edges: [] }, { highlight: new Set(['a']) });
    expect(series(r).data[0]!.itemStyle.opacity).toBe(1);
    expect(series(r).data[0]!.itemStyle.borderWidth).toBe(3);
    expect(series(r).data[1]!.itemStyle.opacity).toBeLessThan(1);
  });

  it('starts known nodes from their previous positions', () => {
    const r = buildGraphOption({ nodes: [node('a'), node('b')], edges: [] }, { positions: { a: [10, 20] } });
    expect(series(r).data[0]).toMatchObject({ x: 10, y: 20 });
    expect(series(r).data[1]).not.toHaveProperty('x');
  });

  it('does not let a label named like an object prototype member break the lens', () => {
    expect(() => buildGraphOption({ nodes: [node('a', '__proto__'), node('b', 'constructor')], edges: [] })).not.toThrow();
  });

  it('renders the fixture graph', () => {
    const fx = FIXTURES['graph.response'] as unknown as GraphTraverseResponse;
    const r = buildGraphOption(fx);
    expect(r.nodes.length).toBe(fx.nodes.length);
    expect(r.categories).toContain('IpAddress');
  });
});

describe('lens', () => {
  it('gives the same label the same colour and shape every time, for any label', () => {
    expect(styleFor(undefined, 'Gene')).toEqual(styleFor(undefined, 'Gene'));
    expect(styleFor(undefined, 'Gene').color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
  it('lets a lens override colour, shape and title property', () => {
    const lens = { labels: { Endpoint: { color: '#000000', symbol: 'diamond' as const, titleProperty: 'path' } } };
    expect(styleFor(lens, 'Endpoint')).toMatchObject({ color: '#000000', symbol: 'diamond' });
    expect(nodeTitle(node('t:Endpoint:/x', 'Endpoint', { path: '/ntseq' }), lens)).toBe('/ntseq');
  });
  it('falls back to the id without its tenant and label prefix', () => {
    expect(displayId('tenant1:IpAddress:203.0.113.50')).toBe('203.0.113.50');
    expect(displayId('tenant1:IpAddress:2001:db8::1')).toBe('2001:db8::1');
    expect(displayId('plain')).toBe('plain');
    expect(nodeTitle(node('tenant1:Ja4:t13d', 'Ja4'))).toBe('t13d');
  });
});

describe('mergeGraph (expand)', () => {
  const base = { nodes: [node('a'), node('b')], edges: [edge('a', 'b')] };
  it('adds only new nodes and edges and keeps existing order', () => {
    const m = mergeGraph(base, { nodes: [node('b'), node('c')], edges: [edge('a', 'b'), edge('b', 'c')] });
    expect(m.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(m.edges.map(edgeKey)).toEqual([edgeKey(edge('a', 'b')), edgeKey(edge('b', 'c'))]);
    expect(m.truncated).toBe(false);
  });
  it('does not modify its inputs', () => {
    mergeGraph(base, { nodes: [node('z')], edges: [] });
    expect(base.nodes).toHaveLength(2);
  });
  it('enforces the cap when expanding and says so', () => {
    const big = { nodes: Array.from({ length: 499 }, (_, i) => node(`n${i}`)), edges: [] };
    const m = mergeGraph(big, { nodes: [node('x1'), node('x2')], edges: [edge('n0', 'x2')] });
    expect(m.nodes).toHaveLength(500);
    expect(m.truncated).toBe(true);
    expect(m.edges).toHaveLength(0);
  });
});

describe('click resolution and search', () => {
  const g = { nodes: [node('a'), node('b')], edges: [edge('a', 'b', 'used')] };
  it('resolves a node click', () => {
    expect(resolveGraphClick({ dataType: 'node', data: { id: 'a' } }, g)).toEqual({ kind: 'node', node: g.nodes[0] });
  });
  it('resolves an edge click to the relation and endpoints', () => {
    const hit = resolveGraphClick({ dataType: 'edge', data: { id: edgeKey(g.edges[0]!) } }, g);
    expect(hit).toEqual({ kind: 'edge', edge: g.edges[0] });
  });
  it('ignores clicks that are not on a known node or edge', () => {
    expect(resolveGraphClick({ dataType: 'node', data: { id: 'zzz' } }, g)).toBeNull();
    expect(resolveGraphClick({ dataType: 'series' }, g)).toBeNull();
    expect(resolveGraphClick({ dataType: 'node', data: { id: 5 } }, g)).toBeNull();
  });
  it('matches on title, id, kind and property values; empty query matches nothing', () => {
    const nodes = [node('tenant1:Endpoint:/ntseq', 'Endpoint', { path: '/ntseq' }), node('x', 'Asn', { org: 'Example Hosting' })];
    expect([...matchNodes(nodes, 'NTSEQ')]).toEqual(['tenant1:Endpoint:/ntseq']);
    expect([...matchNodes(nodes, 'hosting')]).toEqual(['x']);
    expect(matchNodes(nodes, '  ').size).toBe(0);
  });
});

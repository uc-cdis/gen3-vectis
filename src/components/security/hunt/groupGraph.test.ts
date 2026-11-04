import { describe, expect, it } from 'vitest';
import { groupGraph } from './FindSimilar';

const n = (label: string, v: string) => ({ id: `t:${label}:${v}`, label, properties: {} });
const e = (a: ReturnType<typeof n>, b: ReturnType<typeof n>) => ({ src_id: a.id, dst_id: b.id, edge_type: 'x' });

describe('groupGraph', () => {
  const seed = n('IpAddress', '203.0.113.5');
  const sig = n('RequestSignature', 's1');
  const rule = n('DetectionRule', 'r1');
  const other = n('IpAddress', '198.51.100.7');
  const graph = { nodes: [seed, sig, rule, other], edges: [e(seed, sig), e(seed, rule), e(other, sig)] };

  it('separates what ties to the seed from addresses reached only through those', () => {
    const { direct, indirect } = groupGraph(graph, true);
    expect(direct.map((g) => g.title)).toEqual(['Rules it triggered', 'Kinds of request it sent']);
    expect(indirect.map((g) => [g.title, g.nodes.length])).toEqual([['Other IP addresses', 1]]);
  });

  it('groups by kind only when there is no single seed', () => {
    const { direct, indirect } = groupGraph(graph, false);
    expect(indirect).toEqual([]);
    expect(direct.map((g) => g.title)).toContain('Other IP addresses');
  });
});

import { describe, expect, it } from 'vitest';
import { nodeTitle, styleFor } from '@/lib/vectis-kit/entity-graph/lens';
import { securityLens } from './EntityGraphSection';

// The real kinds of the graph contract (vectis_dictionary/commons/vectisprod/graph_contract.json, `labels`).
const LISTED = ['IpAddress', 'Asn', 'UserAgent', 'JA4Fingerprint', 'RequestSignature', 'LogSource', 'Country', 'Finding', 'Host', 'Indicator', 'Technique'];

describe('securityLens', () => {
  it('is keyed by real graph kinds, not by guesses that never match', () => {
    expect(Object.keys(securityLens.labels ?? {}).sort()).toEqual([...LISTED].sort());
    expect(securityLens.labels).not.toHaveProperty('Ja4');
    expect(securityLens.labels).not.toHaveProperty('Endpoint');
  });
  it.each(LISTED)('titles a %s node from properties.name, which is where the gateway sends it', (label) => {
    expect(nodeTitle({ id: `t:${label}:k`, label, properties: { name: 'Shown name', value: 'other', path: '/p' } }, securityLens)).toBe('Shown name');
  });
  it.each(LISTED)('falls back to the id for a %s node with no name', (label) => {
    expect(nodeTitle({ id: `t:${label}:the-key`, label, properties: {} }, securityLens)).toBe('the-key');
  });
  it('keeps a property fallback when name is absent', () => {
    expect(nodeTitle({ id: 't:UserAgent:ua-1', label: 'UserAgent', properties: { value: 'curl/8' } }, securityLens)).toBe('curl/8');
  });
  it('styles the renamed kinds as the guessed ones were styled', () => {
    expect(styleFor(securityLens, 'JA4Fingerprint')).toMatchObject({ color: '#CA9161', symbol: 'triangle' });
    expect(styleFor(securityLens, 'RequestSignature')).toMatchObject({ color: '#56B4E9', symbol: 'roundRect' });
  });
});

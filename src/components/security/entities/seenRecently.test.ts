import { describe, expect, it } from 'vitest';
import type { AlertGroup } from '@/lib/vectis-kit/spec';
import { FIXTURES } from '@/lib/vectis-kit/api/fixtureApi';
import { deriveSeenRecently } from './seenRecently';

const groups = (FIXTURES['alerts.response'] as unknown as { groups: AlertGroup[] }).groups;

describe('deriveSeenRecently', () => {
  it('reads only what the alerts contain: top sources and matched indicators', () => {
    const out = deriveSeenRecently(groups);
    expect(out.map((e) => `${e.type}:${e.value}`).sort()).toEqual(['ip:192.0.2.44', 'ip:198.51.100.200', 'ip:198.51.100.77', 'ip:203.0.113.50']);
  });
  it('does not guess an address for a group whose sources were not computed', () => {
    const g = { ...(groups[0] as AlertGroup), top_sources: null, signature_label: '203.0.113.9: looks like an address', matched_indicators: [] };
    expect(deriveSeenRecently([g])).toEqual([]);
  });
  it('is empty when no alert names an entity', () => {
    expect(deriveSeenRecently(groups.filter((g) => g.group_id === 'g-novel-1'))).toEqual([]);
    expect(deriveSeenRecently([])).toEqual([]);
  });
  it('counts distinct groups and keeps the latest time', () => {
    const base = groups[0] as AlertGroup;
    const src = [{ type: 'ip' as const, value: '203.0.113.9' }];
    const a = { ...base, group_id: 'a', top_sources: src, matched_indicators: ['203.0.113.9'], last_seen: '2026-01-01T00:00:00Z' };
    const b = { ...base, group_id: 'b', top_sources: src, matched_indicators: [], last_seen: '2026-02-01T00:00:00Z' };
    expect(deriveSeenRecently([a, b])).toEqual([{ type: 'ip', value: '203.0.113.9', groups: 2, lastSeen: '2026-02-01T00:00:00Z' }]);
  });
});

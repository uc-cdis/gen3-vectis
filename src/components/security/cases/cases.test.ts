import { describe, expect, it } from 'vitest';
import type { CaseRecord } from '@/lib/vectis-kit/spec';
import { buildPatch, priorityRank, sortCasesByPriority, toCaseCreate, validateCaseFields, validateNote } from './caseModel';

const rec = (over: Partial<CaseRecord> = {}): CaseRecord => ({
  case_id: 'case-1', title: 'T', description: '', status: 'open', priority: 'low', assignee: null, tags: [], group_ids: [], notes: [],
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', etag: 'e1', ...over,
});
const base = { title: 'ok', description: '', tags: [], assignee: '' };

describe('caseModel', () => {
  it('ranks priorities, not strings', () => {
    expect(priorityRank('critical')).toBeGreaterThan(priorityRank('high'));
    expect(priorityRank('medium')).toBeGreaterThan(priorityRank('low'));
    const sorted = sortCasesByPriority(['low', 'medium', 'critical', 'high'].map((p, i) => rec({ case_id: `c${i}`, priority: p as CaseRecord['priority'] })));
    expect(sorted.map((c) => c.priority)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('validates title 1..256 after trimming', () => {
    expect(validateCaseFields({ ...base, title: '' }).title).toMatch(/required/);
    expect(validateCaseFields({ ...base, title: '   ' }).title).toMatch(/required/);
    expect(validateCaseFields({ ...base, title: 'a'.repeat(256) }).title).toBeUndefined();
    expect(validateCaseFields({ ...base, title: 'a'.repeat(257) }).title).toMatch(/256/);
  });

  it('validates description, tags and assignee limits', () => {
    expect(validateCaseFields({ ...base, description: 'x'.repeat(8193) }).description).toBeDefined();
    expect(validateCaseFields({ ...base, description: 'x'.repeat(8192) }).description).toBeUndefined();
    expect(validateCaseFields({ ...base, tags: Array.from({ length: 20 }, (_, i) => `t${i}`) }).tags).toBeUndefined();
    expect(validateCaseFields({ ...base, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }).tags).toMatch(/20/);
    expect(validateCaseFields({ ...base, tags: ['x'.repeat(257)] }).tags).toBeDefined();
    expect(validateCaseFields({ ...base, assignee: 'a'.repeat(257) }).assignee).toBeDefined();
  });

  it('validates notes', () => {
    expect(validateNote('  ')).toBeDefined();
    expect(validateNote('a'.repeat(8193))).toBeDefined();
    expect(validateNote('fine')).toBeUndefined();
  });

  it('builds a create body with only what was entered', () => {
    expect(toCaseCreate({ ...base, title: '  Hello ', priority: 'high' })).toEqual({ title: 'Hello', priority: 'high' });
    expect(toCaseCreate({ ...base, assignee: ' bob ', tags: ['a', 'a', 'b'], priority: 'low' })).toEqual({ title: 'ok', priority: 'low', assignee: 'bob', tags: ['a', 'b'] });
  });

  it('builds a conditional patch of changed fields only, or null', () => {
    const r = rec({ title: 'Old', tags: ['a'] });
    const same = { title: 'Old', description: '', tags: ['a'], assignee: '', priority: 'low' as const, status: 'open' as const };
    expect(buildPatch(r, same)).toBeNull();
    expect(buildPatch(r, { ...same, title: 'New', status: 'resolved' })).toEqual({ expected_etag: 'e1', title: 'New', status: 'resolved' });
    expect(buildPatch(r, { ...same, tags: ['a', 'b'] })).toEqual({ expected_etag: 'e1', tags: ['a', 'b'] });
  });
});

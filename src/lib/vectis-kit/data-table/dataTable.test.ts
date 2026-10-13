import { describe, expect, it } from 'vitest';
import type { ColumnMeta, FilterClause } from '../spec';
import {
  MAX_FILTERS, MAX_IN_VALUES, clauseChips, enumSelection, removeClauseAt, setBoolean, setEnumSelection, setRange, setText, validateClauses,
} from './filters';
import { sanitizeLayout, toColumnar } from './tableModel';

const eq = (i: number): FilterClause => ({ field: 'country', op: 'eq', value: String(i) });

describe('validateClauses', () => {
  it('accepts exactly 20 filters and rejects 21', () => {
    expect(validateClauses(Array.from({ length: MAX_FILTERS }, (_, i) => eq(i))).ok).toBe(true);
    const r = validateClauses(Array.from({ length: MAX_FILTERS + 1 }, (_, i) => eq(i)));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toMatch(/Too many filters/);
  });
  it('accepts 100 `in` values and rejects 101 or none', () => {
    const inn = (n: number): FilterClause => ({ field: 'country', op: 'in', value: Array.from({ length: n }, (_, i) => `v${i}`) });
    expect(validateClauses([inn(MAX_IN_VALUES)]).ok).toBe(true);
    expect(validateClauses([inn(MAX_IN_VALUES + 1)]).ok).toBe(false);
    expect(validateClauses([inn(0)]).ok).toBe(false);
  });
  it('rejects bad column names, long text and non-finite numbers', () => {
    expect(validateClauses([{ field: 'a b', op: 'eq', value: 'x' }]).ok).toBe(false);
    expect(validateClauses([{ field: 'a\n', op: 'eq', value: 'x' }]).ok).toBe(false);
    expect(validateClauses([{ field: 'a', op: 'contains', value: 'x'.repeat(513) }]).ok).toBe(false);
    expect(validateClauses([{ field: 'a', op: 'gte', value: Number.NaN }]).ok).toBe(false);
  });
});

describe('editing clauses', () => {
  it('enum: one value is eq, several is in, none removes', () => {
    let c = setEnumSelection([], 'rule_action', ['BLOCK']);
    expect(c).toEqual([{ field: 'rule_action', op: 'eq', value: 'BLOCK' }]);
    c = setEnumSelection(c, 'rule_action', ['BLOCK', 'ALLOW', 'BLOCK']);
    expect(c).toEqual([{ field: 'rule_action', op: 'in', value: ['BLOCK', 'ALLOW'] }]);
    expect(enumSelection(c, 'rule_action')).toEqual(['BLOCK', 'ALLOW']);
    expect(setEnumSelection(c, 'rule_action', [])).toEqual([]);
  });
  it('range: blank removes, reversed and NaN are refused', () => {
    expect(setRange([], 'status_code', 400, 500).clauses).toHaveLength(2);
    expect(setRange(setRange([], 'status_code', 400, 500).clauses, 'status_code', null, null).clauses).toEqual([]);
    expect(setRange([], 'status_code', 500, 400).error).toMatch(/larger/);
    expect(setRange([], 'status_code', Number.NaN, null).error).toMatch(/numbers/);
  });
  it('text and boolean', () => {
    expect(setText([], 'uri_path', 'contains', '  /admin ')).toEqual([{ field: 'uri_path', op: 'contains', value: '/admin' }]);
    expect(setText([{ field: 'uri_path', op: 'eq', value: 'x' }], 'uri_path', 'eq', '  ')).toEqual([]);
    expect(setBoolean([], 'flag', true)).toEqual([{ field: 'flag', op: 'eq', value: true }]);
  });
  it('removeClauseAt removes one chip', () => {
    expect(removeClauseAt([eq(1), eq(2)], 0)).toEqual([eq(2)]);
  });
  it('chips are plain text, summarise long lists, and keep hostile text as text', () => {
    const cols: ColumnMeta[] = [{ name: 'country', label: 'Country', type: 'string' }];
    const chips = clauseChips([{ field: 'country', op: 'in', value: ['a', 'b', 'c', 'd', 'e'] }, { field: 'country', op: 'eq', value: '<img src=x onerror=alert(1)>' }], cols);
    expect(chips[0]!.label).toBe('Country is one of a, b, c and 2 more');
    expect(chips[1]!.label).toContain('<img');
  });
});

describe('toColumnar', () => {
  const meta: ColumnMeta[] = [
    { name: 't', label: 'T', type: 'timestamp' }, { name: 'n', label: 'N', type: 'integer' }, { name: 'big', label: 'B', type: 'integer' }, { name: 's', label: 'S', type: 'string' },
  ];
  it('keeps exactly the rows given, types them, and widens integers that do not fit 32 bits', () => {
    const rows = [{ t: '2026-10-09T00:00:00Z', n: 1, big: 5_000_000_000, s: { a: 1 } }, { t: 'garbage', n: 'x', big: 1, s: null }];
    const r = toColumnar(['t', 'n', 'big', 's'], rows, meta);
    expect(r.rowCount).toBe(2);
    expect(r.schema).toEqual({ t: 'datetime', n: 'integer', big: 'float', s: 'string' });
    expect(r.data.t).toEqual([Date.parse('2026-10-09T00:00:00Z'), null]);
    expect(r.data.n).toEqual([1, null]);
    expect(r.data.s).toEqual(['{"a":1}', null]);
  });
  it('empty rows give empty columns, not invented ones', () => {
    expect(toColumnar(['s'], [], meta).data).toEqual({ s: [] });
  });
});

describe('sanitizeLayout', () => {
  it('keeps known parts, drops unknown columns and junk', () => {
    expect(sanitizeLayout({ plugin: 'Y Line', group_by: ['src_ip'], split_by: ['nope'], sort: [['src_ip', 'asc'], ['zzz', 'asc']], evil: 1 }, ['src_ip']))
      .toEqual({ plugin: 'Y Line', group_by: ['src_ip'], sort: [['src_ip', 'asc']] });
    expect(sanitizeLayout({ plugin: '"><script>' }, [])).toEqual({});
    expect(sanitizeLayout(null, [])).toEqual({});
  });
});

describe('sanitizeLayout chart settings', () => {
  const cols = ['ts', 'src_ip', 'status'];
  it('keeps a time-bucket expression over a known column and the group_by that uses it', () => {
    const out = sanitizeLayout({ plugin: 'Y Bar', expressions: { 'time bucket': `bucket("ts", 'h')` }, group_by: ['time bucket'], aggregates: { status: 'count' }, columns: ['status'] }, cols);
    expect(out.group_by).toEqual(['time bucket']);
    expect(out.expressions).toEqual({ 'time bucket': `bucket("ts", 'h')` });
    expect(out.aggregates).toEqual({ status: 'count' });
  });
  it('drops any other expression, unknown columns and unknown aggregates', () => {
    const out = sanitizeLayout({ expressions: { x: 'fetch("http://evil")', y: `bucket("nope", 'h')` }, group_by: ['x'], aggregates: { status: 'drop table', ghost: 'sum' } }, cols);
    expect(out).toEqual({});
  });
});

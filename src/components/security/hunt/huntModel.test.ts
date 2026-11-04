import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/lib/vectis-kit/api/fixtureApi';
import type { CatalogResponse, FilterClause, QuerySpec } from '@/lib/vectis-kit/spec';
import { applySpec, defaultColumns, filtersForIndex, groupableColumns, huntLinkFor, linkForQuery, parseFilters, parseRange, readDeepLink, specFromView, EMPTY_VIEW, validateAlertId, validateEntityValue, validateHypothesis, validateTitle, writeDeepLink } from './huntModel';

const catalog = FIXTURES['catalog.response'] as CatalogResponse;
const http = catalog.indexes.find((i) => i.index_name === 'http_activity')!;

describe('validation follows the contract', () => {
  it('titles', () => {
    expect(validateTitle('  ')).not.toBeNull();
    expect(validateTitle('x'.repeat(257))).not.toBeNull();
    expect(validateTitle('x'.repeat(256))).toBeNull();
    expect(validateTitle('a\u0000b')).not.toBeNull();
  });
  it('hypothesis length', () => {
    expect(validateHypothesis('x'.repeat(8192))).toBeNull();
    expect(validateHypothesis('x'.repeat(8193))).not.toBeNull();
  });
  it('alert ids are anchored: a trailing newline or path is rejected', () => {
    expect(validateAlertId('g-ioc-match')).toBeNull();
    expect(validateAlertId('g-ioc-match\n')).not.toBeNull();
    expect(validateAlertId('../x g-1')).not.toBeNull();
    expect(validateAlertId('')).not.toBeNull();
    expect(validateAlertId('a'.repeat(129))).not.toBeNull();
  });
  it('entity values', () => {
    expect(validateEntityValue('203.0.113.50')).toBeNull();
    expect(validateEntityValue('')).not.toBeNull();
    expect(validateEntityValue('x'.repeat(513))).not.toBeNull();
  });
});

describe('windows and deep links', () => {
  it('accepts only ordered ISO windows of at most 92 days', () => {
    expect(parseRange('2026-10-09T10:00:00Z', '2026-10-09T11:00:00Z')).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' });
    expect(parseRange('2026-10-09T11:00:00Z', '2026-10-09T10:00:00Z')).toBeNull();
    expect(parseRange('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z')).toBeNull();
    expect(parseRange('yesterday', 'today')).toBeNull();
    expect(parseRange(undefined, undefined)).toBeNull();
  });
  it('reads and writes the link without touching other query keys, and ignores bad values', () => {
    const q = writeDeepLink({ tab: 'hunt', range: '24h' }, { index: 'api_activity', grain: '1h', range: { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' } });
    expect(q).toMatchObject({ tab: 'hunt', range: '24h', hunt_index: 'api_activity', hunt_grain: '1h' });
    expect(readDeepLink(q)).toEqual({ index: 'api_activity', grain: '1h', range: { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' }, filters: [] });
    expect(readDeepLink({ hunt_index: 'authentication', hunt_grain: '2d', hunt_from: 'x', hunt_to: 'y' })).toEqual({ index: null, grain: null, range: null, filters: [] });
    expect(writeDeepLink(q, { range: null })).not.toHaveProperty('hunt_from');
  });
});

const IN: FilterClause = { field: 'src_ip', op: 'in', value: ['192.0.2.10', '198.51.100.7'] };
const many = (n: number) => Array.from({ length: n }, (_, i) => `192.0.2.${i}`);

describe('filters in the deep link', () => {
  it('round-trips valid filters through the URL', () => {
    const q = writeDeepLink({ tab: 'hunt' }, { filters: [IN, { field: 'status_code', op: 'gte', value: 400 }] });
    expect(readDeepLink(q).filters).toEqual([IN, { field: 'status_code', op: 'gte', value: 400 }]);
    expect(writeDeepLink(q, { filters: null })).not.toHaveProperty('hunt_filters');
    expect(writeDeepLink(q, { filters: [] })).not.toHaveProperty('hunt_filters');
  });

  it.each([
    ['not JSON', '{nope'],
    ['not a list', JSON.stringify({ field: 'src_ip', op: 'eq', value: 'x' })],
    ['empty list', '[]'],
    ['unknown op', JSON.stringify([{ field: 'src_ip', op: 'regex', value: '.*' }])],
    ['bad field name', JSON.stringify([{ field: 'Src IP', op: 'eq', value: 'x' }])],
    ['field with a newline', JSON.stringify([{ field: 'src_ip\n', op: 'eq', value: 'x' }])],
    ['extra key', JSON.stringify([{ ...IN, sql: '1' }])],
    ['in with a scalar', JSON.stringify([{ field: 'src_ip', op: 'in', value: 'x' }])],
    ['in with no values', JSON.stringify([{ field: 'src_ip', op: 'in', value: [] }])],
    ['in with too many values', JSON.stringify([{ field: 'src_ip', op: 'in', value: many(101) }])],
    ['eq with a list', JSON.stringify([{ field: 'src_ip', op: 'eq', value: ['x'] }])],
    ['object value', JSON.stringify([{ field: 'src_ip', op: 'eq', value: { a: 1 } }])],
    ['null value', JSON.stringify([{ field: 'src_ip', op: 'eq', value: null }])],
    ['value too long', JSON.stringify([{ field: 'path', op: 'contains', value: 'x'.repeat(513) }])],
    ['hidden character in a value', JSON.stringify([{ field: 'path', op: 'contains', value: 'a\u202eb' }])],
    ['too many clauses', JSON.stringify(Array.from({ length: 21 }, () => IN))],
    ['one bad clause among good ones', JSON.stringify([IN, { field: 'src_ip', op: 'regex', value: 'x' }])],
  ])('ignores the whole filter set when it is malformed: %s', (_name, raw) => {
    expect(readDeepLink({ hunt_filters: raw }).filters).toEqual([]);
  });

  it('ignores a filter parameter that is far too long without parsing it', () => {
    expect(readDeepLink({ hunt_filters: JSON.stringify([{ field: 'path', op: 'eq', value: 'x'.repeat(40_000) }]) }).filters).toEqual([]);
  });

  it('parseFilters keeps only the contract fields', () => {
    expect(parseFilters([IN])).toEqual([IN]);
    expect(parseFilters('x')).toBeNull();
  });

  it('applies filters only when the index has every column they name', () => {
    expect(filtersForIndex([IN], http)).toEqual([IN]);
    expect(filtersForIndex([IN, { field: 'no_such_column', op: 'eq', value: 'x' }], http)).toEqual([]);
  });
});

describe('the link from an alert', () => {
  const hunt = { index_name: 'http_activity', window: { start: '2026-10-09T09:45:00Z', end: '2026-10-09T10:15:00Z' }, filters: [IN] };

  it('carries index, window and filters, and reads back as the same query', () => {
    const link = huntLinkFor(hunt as never)!;
    expect(link).toMatchObject({ hunt_index: 'http_activity', hunt_from: '2026-10-09T09:45:00.000Z', hunt_to: '2026-10-09T10:15:00.000Z' });
    expect(readDeepLink(link)).toMatchObject({ index: 'http_activity', filters: [IN], range: { start: '2026-10-09T09:45:00.000Z', end: '2026-10-09T10:15:00.000Z' } });
  });

  it.each([
    ['an index Hunt does not cover', { ...hunt, index_name: 'authentication' }],
    ['a window that is reversed', { ...hunt, window: { start: hunt.window.end, end: hunt.window.start } }],
    ['a filter that is malformed', { ...hunt, filters: [{ field: 'src_ip', op: 'regex', value: 'x' }] }],
  ])('gives no link for %s', (_name, bad) => {
    expect(huntLinkFor(bad as never)).toBeNull();
  });
});

describe('spec mapping', () => {
  it('builds a spec from the view, defaulting columns and sort from the catalog', () => {
    const spec = specFromView({ index: http, grain: '5m', view: EMPTY_VIEW, range: null, consoleWindow: { start: '2026-10-09T00:00:00Z', end: '2026-10-10T00:00:00Z' } });
    expect(spec).toMatchObject({ index_name: 'http_activity', grain: '5m', sort: { field: 'event_time', dir: 'desc' }, seed: null });
    expect(spec.columns).toEqual(defaultColumns(http));
    expect(spec.window.start).toBe('2026-10-09T00:00:00Z');
  });
  it('prefers the brushed range for the window', () => {
    const range = { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' };
    expect(specFromView({ index: http, grain: '1m', view: EMPTY_VIEW, range, consoleWindow: { start: 'a', end: 'b' } }).window).toEqual(range);
  });
  it('applies a spec: drops unknown columns, rejects unknown indexes', () => {
    const spec: QuerySpec = { index_name: 'http_activity', window: { start: '2026-10-09T10:00:00Z', end: '2026-10-09T12:00:00Z' }, columns: ['src_ip', 'not_a_column', 'uri_path'], grain: '1h' };
    const a = applySpec(spec, catalog)!;
    expect(a.view.columns).toEqual(['src_ip', 'uri_path']);
    expect(a.grain).toBe('1h');
    expect(a.range).toEqual({ start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T12:00:00.000Z' });
    expect(applySpec({ ...spec, index_name: 'authentication' }, catalog)).toBeNull();
    expect(applySpec({ ...spec, columns: ['nope'] }, catalog)!.view.columns).toBeNull();
  });
  it('group-by choices are the enum columns', () => {
    expect(groupableColumns(http).map((c) => c.value)).toEqual(['http_method', 'rule_action', 'source']);
  });
});

describe('All events', () => {
  const all = catalog.indexes.find((i) => i.index_name === 'all_events')!;
  it('is a hunting index and applying a view of it splits the timeline by index again', () => {
    expect(all).toBeTruthy();
    const spec = { index_name: 'all_events', window: { start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z' }, columns: ['event_time', 'index_name'], filters: [], sort: null } as unknown as QuerySpec;
    const a = applySpec(spec, catalog)!;
    expect(a.index).toBe('all_events');
    expect(a.view.groupBy).toEqual(['index_name']);
  });
  it('a single index applies with no split', () => {
    const spec = { index_name: 'http_activity', window: { start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z' }, columns: [], filters: [], sort: null } as unknown as QuerySpec;
    expect(applySpec(spec, catalog)!.view.groupBy).toEqual([]);
  });
  it('can be chosen from a deep link', () => {
    expect(readDeepLink({ hunt_index: 'all_events' }).index).toBe('all_events');
  });
});

describe('linkForQuery', () => {
  it('writes the link the Data tab and Hunt both read, leaving out a missing range and empty filters', () => {
    const range = { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' };
    const f = [{ field: 'src_ip', op: 'eq', value: '192.0.2.10' }] as const;
    expect(readDeepLink(linkForQuery({ index: 'api_activity', range, filters: f }))).toMatchObject({ index: 'api_activity', range, filters: f });
    expect(linkForQuery({ index: 'api_activity', range: null, filters: [] })).toEqual({ hunt_index: 'api_activity' });
  });
});

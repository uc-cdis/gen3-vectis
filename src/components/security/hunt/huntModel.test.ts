import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/lib/vectis-kit/api/fixtureApi';
import type { CatalogResponse, QuerySpec } from '@/lib/vectis-kit/spec';
import { applySpec, defaultColumns, groupableColumns, parseRange, readDeepLink, specFromView, EMPTY_VIEW, validateAlertId, validateEntityValue, validateHypothesis, validateTitle, writeDeepLink } from './huntModel';

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
    expect(readDeepLink(q)).toEqual({ index: 'api_activity', grain: '1h', range: { start: '2026-10-09T10:00:00.000Z', end: '2026-10-09T11:00:00.000Z' } });
    expect(readDeepLink({ hunt_index: 'authentication', hunt_grain: '2d', hunt_from: 'x', hunt_to: 'y' })).toEqual({ index: null, grain: null, range: null });
    expect(writeDeepLink(q, { range: null })).not.toHaveProperty('hunt_from');
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

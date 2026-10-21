import { describe, expect, it } from 'vitest';
import { ORIGIN_COLUMNS, isOriginColumn, withOrigin } from './origin';

const known = (names: string[]) => names.map((name) => ({ name }));
const ALL = known(['event_time', 'src_ip', 'tenant_id', 'account_id', 'environment', 'source', 'uri_path']);

describe('origin columns stay inside the service\'s column limit', () => {
  it('keeps the origin columns and trims the others from the end', () => {
    const many = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const index = known([...many, ...ORIGIN_COLUMNS]);
    const got = withOrigin(many, index);
    expect(got).toHaveLength(60);
    expect(ORIGIN_COLUMNS.every((c) => got.includes(c))).toBe(true);
    expect(got.slice(0, 5)).toEqual(['c0', ...ORIGIN_COLUMNS]);
    expect(got.at(-1)).toBe('c55');
  });
});

describe('origin columns are never left out of a table', () => {
  it('adds them right after the first column', () => {
    expect(withOrigin(['event_time', 'src_ip'], ALL)).toEqual(['event_time', ...ORIGIN_COLUMNS, 'src_ip']);
  });
  it('keeps the ones already chosen where they are and adds only the missing', () => {
    expect(withOrigin(['event_time', 'source', 'uri_path'], ALL)).toEqual(['event_time', 'tenant_id', 'account_id', 'environment', 'source', 'uri_path']);
  });
  it('adds only what the index has', () => {
    expect(withOrigin(['event_time'], known(['event_time', 'account_id']))).toEqual(['event_time', 'account_id']);
    expect(withOrigin(['event_time'], known(['event_time']))).toEqual(['event_time']);
  });
  it('drops an origin column the index does not have rather than asking for it', () => {
    expect(withOrigin(['event_time', 'environment'], known(['event_time']))).toEqual(['event_time']);
  });
  it('does not repeat a column', () => {
    const got = withOrigin(['account_id', 'event_time', 'account_id'], ALL);
    expect(new Set(got).size).toBe(got.length);
  });
  it('names the four columns', () => {
    expect(ORIGIN_COLUMNS.every(isOriginColumn)).toBe(true);
    expect(isOriginColumn('src_ip')).toBe(false);
  });
});

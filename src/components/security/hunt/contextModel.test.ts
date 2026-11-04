import { describe, expect, it } from 'vitest';
import type { CatalogResponse } from '@/lib/vectis-kit/spec';
import {
  ACTOR_COLUMNS, CONTEXT_COLUMNS, dataLinkFor, investigationFromRow, DEFAULT_SPAN, PER_SIDE, SPANS, actorSupported, contextRequests, eventSummary, fromLocalInput, mergeSide, offsetLabel, readContextLink, toEvent, toLocalInput, writeContextLink,
} from './contextModel';
import type { ContextSpec } from './contextModel';

const col = (name: string) => ({ name });
const index = (index_name: string, names: string[]) => ({ index_name, time_field: 'event_time', columns: names.map(col) });
const catalog = {
  indexes: [
    index('all_events', ['event_time', 'id', 'index_name', 'source', 'src_ip', 'activity', 'outcome', 'severity', 'country']),
    index('http_activity', ['event_time', 'id', 'source', 'src_ip', 'host_header', 'uri_path', 'http_method', 'status_code', 'rule_action', 'session_id']),
    index('network_activity', ['event_time', 'id', 'source', 'src_ip', 'dst_ip', 'dst_port', 'activity']),
    index('authentication', ['event_time', 'id', 'src_ip', 'session_id', 'outcome']),
  ],
} as unknown as CatalogResponse;

const AT = '2026-10-22T14:30:00.000Z';
const spec = (over: Partial<ContextSpec> = {}): ContextSpec => ({ seed: { type: 'ip', value: '203.0.113.9' }, at: AT, span: 5, scope: 'actor', ...over });

describe('contextRequests: where to look and when', () => {
  it('for an address asks every event index, and the egress log as source and as destination, with the address as the filter', () => {
    const r = contextRequests(spec(), catalog);
    expect(r.before.map((q) => [q.index_name, q.filters![0].field])).toEqual([['all_events', 'src_ip'], ['network_activity', 'src_ip'], ['network_activity', 'dst_ip']]);
    for (const q of [...r.before, ...r.after]) expect(q.filters![0]).toEqual({ field: expect.any(String), op: 'eq', value: '203.0.113.9' });
    expect(r.notes).toEqual([]);
  });

  it('reaches the span on each side of the moment, the nearest first: newest before, oldest after', () => {
    const r = contextRequests(spec({ span: 15 }), catalog);
    expect(r.before[0].window).toEqual({ start: '2026-10-22T14:15:00.000Z', end: AT });
    expect(r.before[0].sort).toEqual({ field: 'event_time', dir: 'desc' });
    expect(r.after[0].window).toEqual({ start: AT, end: '2026-10-22T14:45:00.000Z' });
    expect(r.after[0].sort).toEqual({ field: 'event_time', dir: 'asc' });
    expect(r.before[0].paging).toEqual({ limit: PER_SIDE });
  });

  it('never reads the egress log for longer than two hours at once', () => {
    expect(Math.max(...SPANS)).toBeLessThanOrEqual(120);
    const r = contextRequests(spec({ span: Math.max(...SPANS) }), catalog);
    for (const q of [...r.before, ...r.after]) expect(Date.parse(q.window.end) - Date.parse(q.window.start)).toBeLessThanOrEqual(120 * 60_000);
  });

  it('asks only for columns the index has, so a request is never refused for an unknown column', () => {
    const r = contextRequests(spec(), catalog);
    for (const q of r.before) {
      const have = catalog.indexes.find((i) => i.index_name === q.index_name)!.columns.map((c) => c.name);
      expect(q.columns!.every((c) => have.includes(c) && CONTEXT_COLUMNS.includes(c))).toBe(true);
    }
  });

  it('with the toggle on, asks everything in the environment, unfiltered', () => {
    const r = contextRequests(spec({ scope: 'all' }), catalog);
    expect(r.before.map((q) => q.index_name)).toEqual(['all_events', 'network_activity']);
    expect(r.before.every((q) => q.filters!.length === 0)).toBe(true);
  });

  it('skips an index that lacks the column, and says so for an index the catalog does not list', () => {
    const noSession = contextRequests(spec({ seed: { type: 'session', value: 's-1' } }), catalog);
    expect(noSession.before.map((q) => q.index_name)).toEqual(['http_activity', 'authentication']);   // api_activity is not in the catalog
    expect(noSession.notes.some((n) => n.includes('api_activity'))).toBe(true);
    const narrow = { indexes: [index('http_activity', ['event_time', 'id'])] } as unknown as CatalogResponse;
    expect(contextRequests(spec({ seed: { type: 'domain', value: 'a.example.org' } }), narrow).before).toEqual([]);
  });

  it('for an entity kind that no event column holds, asks nothing and says why', () => {
    const r = contextRequests(spec({ seed: { type: 'hash', value: 'a'.repeat(64) } }), catalog);
    expect(r.before).toEqual([]);
    expect(r.after).toEqual([]);
    expect(r.notes[0]).toMatch(/No event column holds a hash/);
    expect(actorSupported('hash')).toBe(false);
    expect(actorSupported('ip')).toBe(true);
    expect(Object.keys(ACTOR_COLUMNS)).not.toContain('user');          // identities are not looked up here: the answer itself would be the leak
  });
});

describe('mergeSide: the nearest events, once each', () => {
  const row = (id: string, time: string, extra: Record<string, unknown> = {}) => ({ id, event_time: time, source: 'waf', ...extra });
  const t = (n: number) => new Date(Date.parse(AT) + n * 1000).toISOString();

  it('keeps the nearest ten before the moment, oldest first', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(`e${i}`, t(-(i + 1))));
    const got = mergeSide([{ index: 'all_events', rows }], 'before');
    expect(got).toHaveLength(PER_SIDE);
    expect(got.map((e) => e.key.split(':')[1])).toEqual(['e9', 'e8', 'e7', 'e6', 'e5', 'e4', 'e3', 'e2', 'e1', 'e0']);   // e0 is closest to the moment, so it is last
  });

  it('keeps the nearest ten after it, oldest first', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(`e${i}`, t(i + 1)));
    const got = mergeSide([{ index: 'all_events', rows }], 'after');
    expect(got.map((e) => e.key.split(':')[1])).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9']);
  });

  it('merges several answers by time and counts an event that came back twice once', () => {
    const a = { index: 'network_activity', rows: [row('x1', t(-3)), row('x2', t(-1))] };
    const b = { index: 'network_activity', rows: [row('x2', t(-1)), row('y1', t(-2))] };       // x2 matched as source and as destination
    expect(mergeSide([a, b], 'before').map((e) => e.key)).toEqual(['network_activity:x1', 'network_activity:y1', 'network_activity:x2']);
  });

  it('is not fooled by the same id in two indexes, and ignores a row with no time', () => {
    const got = mergeSide([{ index: 'a', rows: [row('same', t(-1))] }, { index: 'b', rows: [row('same', t(-2)), { id: 'no-time' }] }], 'before');
    expect(got.map((e) => e.key)).toEqual(['b:same', 'a:same']);
  });

  it('uses the index a row names (the all-events read says which index each came from)', () => {
    const e = toEvent(row('r1', AT, { index_name: 'http_activity' }), 'all_events')!;
    expect(e.index).toBe('http_activity');
    expect(toEvent(row('r2', AT), 'all_events')!.index).toBe('all_events');
  });
});

describe('eventSummary', () => {
  it('says what a web request was', () => {
    expect(eventSummary({ http_method: 'GET', host_header: 'a.example.org', uri_path: '/x', status_code: 404, rule_action: 'ALLOW' })).toBe('GET a.example.org/x 404 ALLOW');
  });
  it('skips what is missing and says nothing for a row with nothing', () => {
    expect(eventSummary({ activity: 'Login', outcome: 'failure', host_header: null, uri_path: '' })).toBe('Login failure');
    expect(eventSummary({})).toBe('');
  });
});

describe('the URL', () => {
  const link = { inv_type: 'ip', inv_value: '203.0.113.9', inv_at: AT, inv_span: '15', inv_scope: 'all' };

  it('round-trips an investigation and keeps the other query keys', () => {
    const s = spec({ span: 15, scope: 'all' });
    const q = writeContextLink({ tab: 'hunt', hunt_grain: '5m' }, s);
    expect(q).toMatchObject({ tab: 'hunt', hunt_grain: '5m', inv_type: 'ip', inv_value: '203.0.113.9', inv_span: '15', inv_scope: 'all' });
    expect(readContextLink(q)).toEqual(s);
    expect(writeContextLink(q, null)).toEqual({ tab: 'hunt', hunt_grain: '5m' });
  });

  it('defaults the span and scope when they are missing or not offered', () => {
    expect(readContextLink({ ...link, inv_span: undefined, inv_scope: undefined })).toMatchObject({ span: DEFAULT_SPAN, scope: 'actor' });
    expect(readContextLink({ ...link, inv_span: '7', inv_scope: 'everything-please' })).toMatchObject({ span: DEFAULT_SPAN, scope: 'actor' });
    expect(readContextLink({ ...link, inv_span: '9999999' })).toMatchObject({ span: DEFAULT_SPAN });
  });

  it.each([
    ['no entity type', { ...link, inv_type: undefined }],
    ['no value', { ...link, inv_value: undefined }],
    ['no time', { ...link, inv_at: undefined }],
    ['a time that is not ISO', { ...link, inv_at: 'yesterday' }],
    ['a time that is not a date', { ...link, inv_at: '2026-13-45T99:99:99Z' }],
    ['a trailing newline in the time', { ...link, inv_at: `${AT}\n` }],
    ['an entity type that does not exist', { ...link, inv_type: 'nonsense' }],
    ['a value with control characters', { ...link, inv_value: '203.0.113.9\u0000' }],
    ['an empty value', { ...link, inv_value: '   ' }],
  ])('is no investigation when the link has %s', (_name, q) => {
    expect(readContextLink(q as Record<string, string | undefined>)).toBeNull();
  });
});

describe('the moment in a date-time field', () => {
  it('round-trips a moment through the local-time field value', () => {
    const iso = '2026-10-22T14:30:07.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
  it('reads a field with no seconds, and refuses anything else', () => {
    expect(fromLocalInput('2026-10-22T07:30')).not.toBeNull();
    for (const bad of ['', 'now', '2026-10-22', '2026-13-45T25:61', '2026-10-22 07:30', '2026-10-22T07:30:00Z']) expect(fromLocalInput(bad)).toBeNull();
    expect(toLocalInput('not a date')).toBe('');
  });
});

describe('offsetLabel', () => {
  it('says how far an event is from the moment, with a sign', () => {
    expect(offsetLabel(AT, AT)).toBe('+0s');
    expect(offsetLabel('2026-10-22T14:29:50.000Z', AT)).toBe('-10s');
    expect(offsetLabel('2026-10-22T14:30:12.000Z', AT)).toBe('+12s');
    expect(offsetLabel('2026-10-22T14:28:55.000Z', AT)).toBe('-1m 05s');
    expect(offsetLabel('nonsense', AT)).toBe('');
  });
});

describe('actorSupported with a type taken from a URL or a log', () => {
  it('is false for names that exist on every object', () => {
    for (const t of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(actorSupported(t)).toBe(false);
  });
});

describe('dataLinkFor: the same events, listed in Data', () => {
  it('names the index, the filter and the whole window the investigation lines up', () => {
    const link = dataLinkFor(spec(), catalog)!;
    expect(link).toMatchObject({ hunt_index: 'all_events', hunt_from: '2026-10-22T14:25:00.000Z', hunt_to: '2026-10-22T14:35:00.000Z' });
    expect(JSON.parse(link.hunt_filters)).toEqual([{ field: 'src_ip', op: 'eq', value: '203.0.113.9' }]);
  });
  it('lists everything in the environment without a filter', () => {
    const link = dataLinkFor(spec({ scope: 'all' }), catalog)!;
    expect(link.hunt_index).toBe('all_events');
    expect(link.hunt_filters).toBeUndefined();
  });
  it('has no link when the only index holding the entity is not one Data lists', () => {
    expect(dataLinkFor(spec({ seed: { type: 'arn', value: 'arn:aws:iam::111122223333:role/x' } }), catalog)).toBeNull();
  });
});

describe('investigationFromRow: from an event to an investigation', () => {
  const meta = [{ name: 'dst_ip', type: 'ip' }, { name: 'src_ip', type: 'ip' }, { name: 'event_time', type: 'timestamp' }] as never;
  it('takes the source address at the event\'s own time', () => {
    expect(investigationFromRow({ dst_ip: '198.51.100.1', src_ip: '203.0.113.9', event_time: '2026-10-22T14:30:00Z' }, meta))
      .toEqual({ seed: { type: 'ip', value: '203.0.113.9' }, at: AT, span: DEFAULT_SPAN, scope: 'actor' });
  });
  it('is null when the row has no address that parses or no time', () => {
    expect(investigationFromRow({ src_ip: 'not-an-address', event_time: AT }, meta)).toBeNull();
    expect(investigationFromRow({ src_ip: '203.0.113.9' }, meta)).toBeNull();
  });
});

/**
 * Pure model for the Hunt investigation: "what happened around this entity at this time".
 *
 * Pick an entity (an address, a domain ...) and a moment. The page shows the events just before and just after that moment, first for the entity
 * alone (the actor) and, with a toggle, for everything in the environment in the same minutes. It is built from the Data API's `rows` route: one
 * request per place the entity can appear and per side, each narrow in time, so each is cheap; this module decides which requests, merges what
 * comes back, and carries the state in the URL so an investigation can be shared as a link.
 */
import type { CatalogResponse, ColumnMeta, EntitySeed, FilterClause, IndexCatalog, RowsRequest } from '@/lib/vectis-kit/spec';
import { isIpAddress } from '@/lib/vectis-kit/spec/indicator';
import { huntIndexes, linkForQuery } from './huntModel';
import { validateEntityInput } from '../entities/entityKeys';

/** Events shown on each side of the moment. */
export const PER_SIDE = 10;
/** How far each side reaches, in minutes. The widest is the longest the egress log may be read for at once (two hours). */
export const SPANS: readonly number[] = [1, 5, 15, 30, 60, 120];
export const DEFAULT_SPAN = 5;
export type Scope = 'actor' | 'all';

/** Where an entity's own events live: [index, column]. Mirrors the backend's entity-to-column map, with ``all_events`` for an address so one read covers every event index. */
export const ACTOR_COLUMNS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  ip: [['all_events', 'src_ip'], ['network_activity', 'src_ip'], ['network_activity', 'dst_ip']],
  domain: [['http_activity', 'host_header']],
  host: [['http_activity', 'host_header']],
  path: [['http_activity', 'uri_path']],
  session: [['http_activity', 'session_id'], ['api_activity', 'session_id'], ['authentication', 'session_id']],
  arn: [['api_activity', 'principal_arn'], ['authentication', 'principal_arn']],
};
/** Everything in the environment: every event index (all_events) and the egress log, which all_events leaves out. */
export const EVERYTHING_INDEXES: readonly string[] = ['all_events', 'network_activity'];
/** The columns shown for an event; each index offers the ones it has. */
export const CONTEXT_COLUMNS: readonly string[] = [
  'event_time', 'id', 'index_name', 'source', 'src_ip', 'dst_ip', 'dst_port', 'http_method', 'host_header', 'uri_path', 'status_code', 'rule_action',
  'activity', 'outcome', 'severity', 'country', 'principal_arn', 'session_id', 'user_agent',
];

export interface ContextSpec {
  seed: EntitySeed;
  /** The moment, ISO 8601 UTC. */
  at: string;
  /** Minutes each side reaches. */
  span: number;
  scope: Scope;
}

/** A value in an event that can be followed: click it to hunt on that instead. */
export interface Pivot { seed: EntitySeed; role: string }

/** One event as the page shows it. */
export interface ContextEvent {
  key: string;
  time: string;
  index: string;
  source: string | null;
  srcIp: string | null;
  dstIp: string | null;
  summary: string;
  /** Every value in the event the hunt can follow, in reading order: the sender, the target, the host, the path, the principal, the session. */
  pivots: Pivot[];
  /** What the sender called itself (shown, not followed: no event column is keyed by it). */
  userAgent: string | null;
}

export interface ContextRequests {
  before: RowsRequest[];
  after: RowsRequest[];
  /** What could not be asked, in words (an entity kind no event column holds, an index the catalog does not list). */
  notes: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const isSpan = (n: number): boolean => SPANS.includes(n);

export const actorSupported = (type: string): boolean => Object.hasOwn(ACTOR_COLUMNS, type);

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
const indexOf = (catalog: CatalogResponse, name: string): IndexCatalog | undefined => catalog.indexes.find((i) => i.index_name === name);

/** The rows requests for a spec: for each place to look, the nearest `PER_SIDE` events before the moment (newest first) and after it (oldest first). */
export function contextRequests(spec: ContextSpec, catalog: CatalogResponse): ContextRequests {
  const at = Date.parse(spec.at);
  const reach = spec.span * 60_000;
  const windows = {
    before: { start: new Date(at - reach).toISOString(), end: new Date(at).toISOString() },
    after: { start: new Date(at).toISOString(), end: new Date(at + reach).toISOString() },
  };
  const notes: string[] = [];
  const places: { index: string; filters: FilterClause[] }[] = [];
  if (spec.scope === 'all') {
    for (const index of EVERYTHING_INDEXES) places.push({ index, filters: [] });
  } else {
    const columns = Object.hasOwn(ACTOR_COLUMNS, spec.seed.type) ? ACTOR_COLUMNS[spec.seed.type] : undefined;
    if (!columns) notes.push(`No event column holds a ${spec.seed.type} value, so there are no events to line up. What the graph knows about it is shown instead.`);
    for (const [index, field] of columns ?? []) places.push({ index, filters: [{ field, op: 'eq', value: spec.seed.value }] });
  }
  const before: RowsRequest[] = [];
  const after: RowsRequest[] = [];
  for (const { index, filters } of places) {
    const meta = indexOf(catalog, index);
    if (!meta) { notes.push(`The ${index} index is not in the data catalog, so it is left out.`); continue; }
    const have = new Set(meta.columns.map((c) => c.name));
    if (filters.some((f) => !have.has(f.field))) continue;     // this index has no such column: the entity cannot appear in it
    const columns = CONTEXT_COLUMNS.filter((c) => have.has(c));
    const base = { index_name: index, columns, filters };
    before.push({ ...base, window: windows.before, sort: { field: meta.time_field, dir: 'desc' }, paging: { limit: PER_SIDE } });
    after.push({ ...base, window: windows.after, sort: { field: meta.time_field, dir: 'asc' }, paging: { limit: PER_SIDE } });
  }
  return { before, after, notes };
}

/** A short line saying what the event was, from whichever of its fields the index has. */
export function eventSummary(row: Record<string, unknown>): string {
  const where = [text(row.host_header), text(row.uri_path)].filter(Boolean).join('');
  const parts = [text(row.http_method), where || null, text(row.status_code), text(row.rule_action), text(row.activity), text(row.outcome)];
  return parts.filter((p): p is string => p !== null).join(' ');
}

/** The values in an event the hunt can follow, each once: ``ip`` and ``domain`` and ``path`` and ``arn`` and ``session`` are the kinds with an event column to line up. */
export function pivotsOf(row: Record<string, unknown>): Pivot[] {
  const found: Pivot[] = [];
  const add = (type: EntitySeed['type'], value: string | null, role: string) => {
    if (value === null || !actorSupported(type) || found.some((p) => p.seed.type === type && p.seed.value === value)) return;
    if ('error' in validateEntityInput(type, value)) return;
    found.push({ seed: { type, value }, role });
  };
  const src = text(row.src_ip);
  const dst = text(row.dst_ip);
  if (src !== null && isIpAddress(src)) add('ip', src, 'sender');
  if (dst !== null && isIpAddress(dst)) add('ip', dst, 'target');
  const host = text(row.host_header);
  if (host !== null) add(isIpAddress(host) ? 'ip' : 'domain', host, 'host');
  const path = text(row.uri_path);
  if (path !== null && path.startsWith('/')) add('path', path, 'path');
  const principal = text(row.principal_arn);
  if (principal !== null && principal.startsWith('arn:')) add('arn', principal, 'principal');
  add('session', text(row.session_id), 'session');
  return found;
}

export function toEvent(row: Record<string, unknown>, index: string): ContextEvent | null {
  const time = text(row.event_time);
  if (time === null) return null;
  const id = text(row.id);
  const idx = text(row.index_name) ?? index;
  return {
    key: `${idx}:${id ?? `${time}:${text(row.src_ip) ?? ''}:${text(row.dst_ip) ?? ''}`}`, time, index: idx, source: text(row.source), srcIp: text(row.src_ip), dstIp: text(row.dst_ip),
    summary: eventSummary(row), pivots: pivotsOf(row), userAgent: text(row.user_agent),
  };
}

/** Merge the answers for one side: the same event is counted once (an address can be both source and destination), the nearest `PER_SIDE` are kept, oldest first. */
export function mergeSide(answers: { index: string; rows: Record<string, unknown>[] }[], side: 'before' | 'after'): ContextEvent[] {
  const seen = new Map<string, ContextEvent>();
  for (const { index, rows } of answers) {
    for (const row of rows) {
      const e = toEvent(row, index);
      if (e && !seen.has(e.key)) seen.set(e.key, e);
    }
  }
  const byTime = (a: ContextEvent, b: ContextEvent) => Date.parse(a.time) - Date.parse(b.time) || (a.key < b.key ? -1 : 1);
  const all = [...seen.values()].sort(byTime);
  return side === 'before' ? all.slice(-PER_SIDE) : all.slice(0, PER_SIDE);
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** An ISO moment as the value of a browser date-time field, which is local time with no zone: "2026-10-22T07:30:00". */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** What a date-time field holds, back to an ISO UTC moment; null when it is empty or not a date. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** "-1m 05s" / "+12s": how far an event is from the moment. */
export function offsetLabel(eventIso: string, atIso: string): string {
  const ms = Date.parse(eventIso) - Date.parse(atIso);
  if (!Number.isFinite(ms)) return '';
  const total = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sign = ms < 0 ? '-' : '+';
  if (h > 0) return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
  return m > 0 ? `${sign}${m}m ${String(s).padStart(2, '0')}s` : `${sign}${s}s`;
}

// ------------------------------------------------------------------ URL

const KEYS = { type: 'inv_type', value: 'inv_value', at: 'inv_at', span: 'inv_span', scope: 'inv_scope' } as const;
type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The investigation in the URL, or null when there is none or any part of it is not valid. Nothing unvalidated reaches a request. */
export function readContextLink(q: Query): ContextSpec | null {
  const type = first(q[KEYS.type]);
  const value = first(q[KEYS.value]);
  const at = first(q[KEYS.at]);
  if (type === undefined || value === undefined || at === undefined || !ISO.test(at) || !Number.isFinite(Date.parse(at))) return null;
  const checked = validateEntityInput(type, value);
  if ('error' in checked) return null;
  const spanText = first(q[KEYS.span]);
  const span = spanText !== undefined && /^\d{1,3}$/.test(spanText) && isSpan(Number(spanText)) ? Number(spanText) : DEFAULT_SPAN;
  const scope: Scope = first(q[KEYS.scope]) === 'all' ? 'all' : 'actor';
  return { seed: checked.seed, at: new Date(Date.parse(at)).toISOString(), span, scope };
}

/** The moment of a new investigation is "the entity's last activity" until its profile says when that was; the link carries this word instead of a time. */
export const LAST_ACTIVITY = 'last';

/** An investigation that has an entity but not yet a moment: ``inv_at=last``. The page looks the moment up and rewrites the link with it. */
export function readPendingLast(q: Query): { seed: EntitySeed; span: number; scope: Scope } | null {
  const type = first(q[KEYS.type]);
  const value = first(q[KEYS.value]);
  if (type === undefined || value === undefined || first(q[KEYS.at]) !== LAST_ACTIVITY) return null;
  const checked = validateEntityInput(type, value);
  if ('error' in checked) return null;
  const spanText = first(q[KEYS.span]);
  const span = spanText !== undefined && /^\d{1,3}$/.test(spanText) && isSpan(Number(spanText)) ? Number(spanText) : DEFAULT_SPAN;
  return { seed: checked.seed, span, scope: first(q[KEYS.scope]) === 'all' ? 'all' : 'actor' };
}

export function writePendingLast(q: Query, p: { seed: EntitySeed; span: number; scope: Scope }): Record<string, string> {
  const next = writeContextLink(q, null);
  next[KEYS.type] = p.seed.type;
  next[KEYS.value] = p.seed.value;
  next[KEYS.at] = LAST_ACTIVITY;
  next[KEYS.span] = String(p.span);
  next[KEYS.scope] = p.scope;
  return next;
}

/** A new query with the investigation set (or removed with null). Other keys are kept. */
export function writeContextLink(q: Query, spec: ContextSpec | null): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) { const s = first(v); if (s !== undefined && s !== '') next[k] = s; }
  for (const k of Object.values(KEYS)) delete next[k];
  if (spec) {
    next[KEYS.type] = spec.seed.type;
    next[KEYS.value] = spec.seed.value;
    next[KEYS.at] = spec.at;
    next[KEYS.span] = String(spec.span);
    next[KEYS.scope] = spec.scope;
  }
  return next;
}

/** The Data-tab link that lists every event this investigation lines up over the same window; null when no hunt index holds the entity. */
export function dataLinkFor(spec: ContextSpec, catalog: CatalogResponse): Record<string, string> | null {
  const open = new Set(huntIndexes(catalog).map((i) => i.index_name));
  const places = spec.scope === 'all' ? [[EVERYTHING_INDEXES[0], ''] as const] : (ACTOR_COLUMNS[spec.seed.type] ?? []);
  const place = places.find(([index]) => open.has(index as never));
  if (!place) return null;
  const at = Date.parse(spec.at);
  const reach = spec.span * 60_000;
  const filters: FilterClause[] = place[1] ? [{ field: place[1], op: 'eq', value: spec.seed.value }] : [];
  return linkForQuery({ index: place[0] as never, range: { start: new Date(at - reach).toISOString(), end: new Date(at + reach).toISOString() }, filters });
}

/** An investigation from one event row: its address (src_ip first) at the row's own time; null when the row has neither. */
export function investigationFromRow(row: Record<string, unknown>, meta: readonly ColumnMeta[]): ContextSpec | null {
  const named = (type: string, prefer: string) => [...meta.filter((m) => m.type === type)].sort((a, b) => Number(b.name === prefer) - Number(a.name === prefer));
  const address = named('ip', 'src_ip').map((m) => row[m.name]).find((v): v is string => typeof v === 'string' && isIpAddress(v));
  const time = named('timestamp', 'event_time').map((m) => row[m.name]).find((v): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)));
  return address && time ? { seed: { type: 'ip', value: address }, at: new Date(Date.parse(time)).toISOString(), span: DEFAULT_SPAN, scope: 'actor' } : null;
}

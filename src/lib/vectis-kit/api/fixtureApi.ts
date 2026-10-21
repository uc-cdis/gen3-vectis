/**
 * Development and test backend. Serves the contract-validated fixtures with the behaviour the UI needs
 * (filtering, paging, in-memory edits) so pages can be built and tested without the service.
 *
 * It must never run in production: `createApi()` only imports this module when NODE_ENV is not "production",
 * and the data is synthetic (reserved documentation addresses only).
 */
import { cloneDeep } from 'lodash';
import type * as C from '../spec';
import { severityRank } from '../spec';
import fixtureFile from '../spec/generated/fixtures.json';
import type { SiemApi, CallInput } from './client';
import { ApiError } from './client';
import type { ApiMap, RouteName } from './routes';
import { sanitizeUntrusted } from '@/lib/safe-text';

/** name -> payload, each already validated against the contract by the exporter and by spec/contract.test.ts. */
export const FIXTURES: Record<string, unknown> = fixtureFile.fixtures;
export const FIXTURE_ANCHOR: string = fixtureFile.anchor;


const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Shift every timestamp so the fixture's anchor is "now": the data looks live whenever it is opened. */
function rebase<T>(value: T, deltaMs: number): T {
  if (typeof value === 'string') {
    return (ISO.test(value) ? new Date(new Date(value).getTime() + deltaMs).toISOString() : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => rebase(v, deltaMs)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rebase(v, deltaMs)])) as T;
  }
  return value;
}

export interface FixtureOptions {
  /** 'healthy' serves a pipeline with nothing quarantined in the window (older records still exist). */
  scenario?: 'healthy';
}

export function createFixtureApi(delayMs = 120, options: FixtureOptions = {}): SiemApi {
  const delta = Date.now() - new Date(FIXTURE_ANCHOR).getTime();
  const fx = <T>(name: string): T => cloneDeep(rebase(FIXTURES[name] as T, delta));
  // in-memory state so edits are visible across the session
  const alerts = fx<C.AlertsResponse>('alerts.response');
  const cases = fx<C.CaseList>('cases.list');
  const hunts = fx<C.HuntList>('hunts.list');
  const views = fx<C.SavedViewList>('views.list');

  const handlers: { [K in RouteName]: (input: CallInput<K>) => ApiMap[K][1] } = {
    catalog: () => fx('catalog.response'),
    overview: () => fx('overview.response'),
    timeline: (i) => {
      const t = fx<C.TimelineResponse>('timeline.response');
      return { ...t, grain: i.body?.grain ?? t.grain };
    },
    rows: (i) => {
      const r = fx<C.RowsResponse>('rows.response');
      const { limit = 250, offset = 0 } = i.body?.paging ?? {};
      let rows = r.rows;
      for (const f of i.body?.filters ?? []) {
        rows = rows.filter((row) => {
          const v = row[f.field];
          if (f.op === 'eq') return String(v) === String(f.value);
          if (f.op === 'neq') return String(v) !== String(f.value);
          if (f.op === 'in') return (f.value as unknown[]).map(String).includes(String(v));
          if (f.op === 'contains') return String(v ?? '').toLowerCase().includes(String(f.value).toLowerCase());
          if (f.op === 'gte') return Number(v) >= Number(f.value);
          return Number(v) <= Number(f.value);
        });
      }
      const s = i.body?.sort;
      if (s) rows = [...rows].sort((a, b) => (String(a[s.field] ?? '') < String(b[s.field] ?? '') ? -1 : 1) * (s.dir === 'asc' ? 1 : -1));
      return { ...r, rows: rows.slice(offset, offset + limit), total: rows.length, truncated: rows.length > offset + limit };
    },
    facets: (i) => {
      const f = fx<C.FacetsResponse>('facets.response');
      const want = new Set(i.body?.fields ?? []);
      return { ...f, facets: f.facets.filter((x) => want.has(x.field)) };
    },
    aggregate: (i) => {
      const b = i.body;
      const group = b?.group_by ?? [];
      // Serve the fixture's own grouping as written; count any other grouping from the fixture rows.
      const canned = fx<C.AggregateResponse>('aggregate.response');
      if (group.join(',') === canned.group_by.join(',')) return { ...canned, index_name: b?.index_name ?? canned.index_name };
      const r = fx<C.RowsResponse>('rows.response');
      const known = new Set(r.rows.flatMap((row) => Object.keys(row)));
      if (group.length === 0 || group.some((g) => !known.has(g))) throw new ApiError(422, 'Unknown column for this index.', 'aggregate');
      const cells = new Map<string, number>();
      for (const row of r.rows) {
        const key = JSON.stringify(group.map((g) => (row[g] === null || row[g] === undefined ? null : String(row[g]))));
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
      const total = [...cells.values()].reduce((a, n) => a + n, 0);
      const byFirst = new Map<string | null, number>();
      for (const [k, n] of cells) { const v = (JSON.parse(k) as (string | null)[])[0] ?? null; byFirst.set(v, (byFirst.get(v) ?? 0) + n); }
      const keep = new Set([...byFirst.entries()].sort((a, c) => c[1] - a[1]).slice(0, b?.top_n ?? 15).map(([v]) => v));
      const rows = [...cells.entries()]
        .map(([k, n]) => ({ values: JSON.parse(k) as (string | null)[], count: n }))
        .filter((c) => keep.has(c.values[0] ?? null))
        .sort((a, c) => c.count - a.count);
      return { index_name: b?.index_name ?? 'all_events', group_by: group, rows, total, truncated: byFirst.size > keep.size, as_of: new Date().toISOString(), notes: [] };
    },
    alerts: (i) => {
      const b = i.body;
      let groups = alerts.groups;
      if (b?.min_severity) groups = groups.filter((g) => severityRank(g.severity) >= severityRank(b.min_severity as C.AlertGroup['severity']));
      if (b?.detector_tiers?.length) groups = groups.filter((g) => b.detector_tiers!.includes(g.detector_tier));
      if (b?.statuses?.length) groups = groups.filter((g) => b.statuses!.includes(g.status ?? 'new'));
      if (!b?.include_noise) groups = groups.filter((g) => !g.noise);
      const sort = b?.sort ?? 'severity';
      groups = [...groups].sort((x, y) =>
        sort === 'last_seen' ? y.last_seen.localeCompare(x.last_seen)
        : sort === 'occurrence_count' ? y.occurrence_count - x.occurrence_count
        : sort === 'novelty_score' ? (y.novelty_score ?? -1) - (x.novelty_score ?? -1)
        : y.severity_score - x.severity_score || y.last_seen.localeCompare(x.last_seen));
      const { limit = 250, offset = 0 } = b?.paging ?? {};
      return { ...alerts, groups: groups.slice(offset, offset + limit), total: groups.length, truncated: groups.length > offset + limit };
    },
    alertGet: (i) => {
      const g = alerts.groups.find((x) => x.group_id === i.params?.id);
      if (!g) throw new ApiError(404, 'Alert not found.', 'alertGet');
      return cloneDeep(g);
    },
    alertWhy: (i) => {
      const id = i.params?.id as string;
      const w = FIXTURES[`why.${id}`];
      if (!w) throw new ApiError(404, 'No explanation for this alert.', 'alertWhy');
      return cloneDeep(rebase(w as C.WhyResponse, delta));
    },
    alertPatch: (i) => {
      const g = alerts.groups.find((x) => x.group_id === i.params?.id);
      if (!g) throw new ApiError(404, 'Alert not found.', 'alertPatch');
      Object.assign(g, Object.fromEntries(Object.entries(i.body ?? {}).filter(([k, v]) => k !== 'expected_etag' && v !== null && v !== undefined)));
      return cloneDeep(g);
    },
    alertBulk: (i) => {
      const updated: string[] = [];
      for (const id of i.body?.group_ids ?? []) {
        const g = alerts.groups.find((x) => x.group_id === id);
        if (g) { Object.assign(g, Object.fromEntries(Object.entries(i.body?.patch ?? {}).filter(([k, v]) => k !== 'expected_etag' && v !== null && v !== undefined))); updated.push(id); }
      }
      return { updated, failed: {} };
    },
    alertAiSummary: () => fx('ai.not_configured'),
    triage: () => fx('triage.response'),
    cases: () => cloneDeep(cases),
    caseCreate: (i) => {
      const now = new Date().toISOString();
      const rec: C.CaseRecord = { case_id: `case-${String(cases.cases.length + 1).padStart(4, '0')}`, title: i.body!.title, description: i.body!.description ?? '',
        status: 'open', priority: i.body!.priority ?? 'medium', assignee: i.body!.assignee ?? null, tags: i.body!.tags ?? [], group_ids: i.body!.group_ids ?? [],
        notes: [], created_at: now, updated_at: now, etag: 'e-new-1' };
      cases.cases.unshift(rec); cases.total += 1;
      for (const id of rec.group_ids) { const g = alerts.groups.find((x) => x.group_id === id); if (g) g.case_id = rec.case_id; }
      return cloneDeep(rec);
    },
    caseGet: (i) => {
      const c = cases.cases.find((x) => x.case_id === i.params?.id);
      if (!c) throw new ApiError(404, 'Case not found.', 'caseGet');
      return cloneDeep(c);
    },
    casePatch: (i) => {
      const c = cases.cases.find((x) => x.case_id === i.params?.id);
      if (!c) throw new ApiError(404, 'Case not found.', 'casePatch');
      if (i.body!.expected_etag !== c.etag) throw new ApiError(412, 'This case changed since you opened it. Reload and try again.', 'casePatch');
      const { add_note, expected_etag: _e, ...rest } = i.body!;
      Object.assign(c, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== undefined)));
      if (add_note) c.notes.push({ note_id: `n-${c.notes.length + 1}`, author: 'you', author_kind: 'analyst', at: new Date().toISOString(), body: add_note });
      c.updated_at = new Date().toISOString(); c.etag = `${c.etag}+`;
      return cloneDeep(c);
    },
    decision: (i) => ({ group_id: i.body!.group_id, disposition: i.body!.disposition, recorded_by: 'you', recorded_at: new Date().toISOString() }),
    graph: () => fx('graph.response'),
    similar: () => fx('similar.response'),
    findSimilar: () => fx('find-similar.response'),
    entityProfile: (i) => ({ ...fx<C.EntityProfileResponse>('entity.profile'), type: i.body!.type, value: i.body!.value, key: `${i.body!.type}:${i.body!.value}` }),
    watchlist: () => fx('watchlist.response'),
    coverage: () => fx('coverage.response'),
    views: () => cloneDeep(views),
    accounts: () => fx('accounts.names'),
    hunts: () => cloneDeep(hunts),
    huntCreate: (i) => {
      const now = new Date().toISOString();
      const h: C.Hunt = { hunt_id: `hunt-${String(hunts.hunts.length + 1).padStart(4, '0')}`, title: i.body!.title, hypothesis: i.body!.hypothesis ?? '', verdict: 'open',
        spec: i.body!.spec, created_by: 'you', created_at: now, updated_at: now, etag: 'h-new-1' };
      hunts.hunts.unshift(h); hunts.total += 1; return cloneDeep(h);
    },
    huntPatch: (i) => {
      const h = hunts.hunts.find((x) => x.hunt_id === i.params?.id);
      if (!h) throw new ApiError(404, 'Hunt not found.', 'huntPatch');
      const { expected_etag: _e, ...rest } = i.body!;
      Object.assign(h, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== undefined)));
      h.updated_at = new Date().toISOString(); return cloneDeep(h);
    },
    health: () => fx(options.scenario === 'healthy' ? 'health.healthy' : 'health.response'),
    quarantine: (i) => {
      const r = fx<C.QuarantineResponse>(i.body?.older ? 'quarantine.older' : options.scenario === 'healthy' ? 'quarantine.empty' : 'quarantine.response');
      const reason = i.body?.reason;
      const matching = reason ? r.records.filter((x) => x.reason === reason) : r.records;
      const { limit = 100, offset = 0 } = i.body?.paging ?? {};
      return { ...r, records: matching.slice(offset, offset + limit), total: matching.length };
    },
    resolveIndicators: (i) => {
      const known = fx<C.IndicatorResolveResponse>('indicators.resolve').matches;
      return { matches: (i.body?.ids ?? []).map((id) => known.find((m) => m.indicator_id === id) ?? { value: id, type: null, indicator_id: id, revoked: false, indicator_types: [] }) };
    },
  };

  return {
    mode: 'fixtures',
    async call<K extends RouteName>(name: K, input: CallInput<K> = {}): Promise<ApiMap[K][1]> {
      await new Promise((r) => setTimeout(r, delayMs));
      // Same boundary treatment as the live client, so tests see what production would.
      return sanitizeUntrusted((handlers[name] as (i: CallInput<K>) => ApiMap[K][1])(input));
    },
  };
}

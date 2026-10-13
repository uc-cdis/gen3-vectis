/**
 * Every endpoint the console may call. One table drives the typed client AND the server-side proxy allowlist,
 * so a route that is not listed here can neither be called from the browser nor forwarded by the proxy.
 */
import type * as C from '../spec';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface RouteDef {
  readonly method: Method;
  readonly path: string; // segments joined by "/", ":name" is a path parameter
}

export const ROUTES = {
  catalog: { method: 'GET', path: 'catalog' },
  overview: { method: 'POST', path: 'overview' },
  timeline: { method: 'POST', path: 'timeline' },
  rows: { method: 'POST', path: 'rows' },
  facets: { method: 'POST', path: 'facets' },
  alerts: { method: 'POST', path: 'alerts' },
  alertGet: { method: 'GET', path: 'alerts/:id' },
  alertWhy: { method: 'GET', path: 'alerts/:id/why' },
  alertPatch: { method: 'PATCH', path: 'alerts/:id' },
  alertBulk: { method: 'POST', path: 'alerts/bulk' },
  alertAiSummary: { method: 'GET', path: 'alerts/:id/ai-summary' },
  triage: { method: 'POST', path: 'triage' },
  cases: { method: 'GET', path: 'cases' },
  caseCreate: { method: 'POST', path: 'cases' },
  caseGet: { method: 'GET', path: 'cases/:id' },
  casePatch: { method: 'PATCH', path: 'cases/:id' },
  decision: { method: 'POST', path: 'decisions' },
  graph: { method: 'POST', path: 'graph/traverse' },
  similar: { method: 'POST', path: 'similar' },
  findSimilar: { method: 'POST', path: 'find-similar' },
  entityProfile: { method: 'POST', path: 'entity/profile' },
  watchlist: { method: 'POST', path: 'watchlist' },
  coverage: { method: 'GET', path: 'coverage' },
  views: { method: 'GET', path: 'views' },
  hunts: { method: 'GET', path: 'hunts' },
  huntCreate: { method: 'POST', path: 'hunts' },
  huntPatch: { method: 'PATCH', path: 'hunts/:id' },
  health: { method: 'GET', path: 'pipeline/health' },
  quarantine: { method: 'POST', path: 'pipeline/quarantine' },
  resolveIndicators: { method: 'POST', path: 'indicators/resolve' },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof ROUTES;

type NoBody = undefined;

/** [request body, response body] per route. */
export interface ApiMap {
  catalog: [NoBody, C.CatalogResponse];
  overview: [C.OverviewRequest, C.OverviewResponse];
  timeline: [C.TimelineRequest, C.TimelineResponse];
  rows: [C.RowsRequest, C.RowsResponse];
  facets: [C.FacetsRequest, C.FacetsResponse];
  alerts: [C.AlertsRequest, C.AlertsResponse];
  alertGet: [NoBody, C.AlertGroup];
  alertWhy: [NoBody, C.WhyResponse];
  alertPatch: [C.AlertPatch, C.AlertGroup];
  alertBulk: [C.AlertBulkRequest, C.AlertBulkResponse];
  alertAiSummary: [NoBody, C.AiSummaryResponse];
  triage: [C.TriageRequest, C.TriageResponse];
  cases: [NoBody, C.CaseList];
  caseCreate: [C.CaseCreate, C.CaseRecord];
  caseGet: [NoBody, C.CaseRecord];
  casePatch: [C.CasePatch, C.CaseRecord];
  decision: [C.DecisionRequest, C.DecisionResponse];
  graph: [C.GraphTraverseRequest, C.GraphTraverseResponse];
  similar: [C.SimilarRequest, C.SimilarResponse];
  findSimilar: [C.FindSimilarRequest, C.FindSimilarResponse];
  entityProfile: [C.EntityProfileRequest, C.EntityProfileResponse];
  watchlist: [C.WatchlistRequest, C.WatchlistResponse];
  coverage: [NoBody, C.CoverageResponse];
  views: [NoBody, C.SavedViewList];
  hunts: [NoBody, C.HuntList];
  huntCreate: [C.HuntCreate, C.Hunt];
  huntPatch: [C.HuntPatch, C.Hunt];
  health: [NoBody, C.HealthResponse];
  quarantine: [C.QuarantineRequest, C.QuarantineResponse];
  resolveIndicators: [C.IndicatorResolveRequest, C.IndicatorResolveResponse];
}

/** Same grammar as the backend's `Identifier`: never accepts whitespace, slashes or control characters. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function buildPath(name: RouteName, params?: Record<string, string>): string {
  const def: RouteDef = ROUTES[name];
  return def.path
    .split('/')
    .map((seg) => {
      if (!seg.startsWith(':')) return seg;
      const value = params?.[seg.slice(1)];
      if (value === undefined || !ID_PATTERN.test(value)) {
        throw new Error(`invalid or missing path parameter "${seg.slice(1)}" for ${name}`);
      }
      return encodeURIComponent(value);
    })
    .join('/');
}

/** Server-side allowlist: which route does this method + path denote, if any. */
export function matchRoute(method: string, segments: readonly string[]): { name: RouteName; params: Record<string, string> } | null {
  for (const name of Object.keys(ROUTES) as RouteName[]) {
    const def: RouteDef = ROUTES[name];
    if (def.method !== method) continue;
    const parts = def.path.split('/');
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] as string;
      const seg = segments[i] as string;
      if (part.startsWith(':')) {
        if (!ID_PATTERN.test(seg)) { ok = false; break; }
        params[part.slice(1)] = seg;
      } else if (part !== seg) {
        ok = false;
        break;
      }
    }
    // a literal route (alerts/bulk) must win over a parameterised sibling (alerts/:id)
    if (ok) return { name, params };
  }
  return null;
}

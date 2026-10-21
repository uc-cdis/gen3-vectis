import { GEN3_API, GEN3_GUPPY_API } from '@gen3/core';
import { sanitizeUntrusted } from '@/lib/safe-text';
import type { GraphTraverseResponse } from '../spec';

const QUERY = 'query Traverse($startId: String!, $maxHops: Int, $limit: Int) { graphTraverse(startId: $startId, maxHops: $maxHops, limit: $limit) }';

export class GatewayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}

type Wire = {
  data?: { graphTraverse?: { nodes?: unknown[]; edges?: unknown[]; truncated?: boolean } | null };
  errors?: { message?: string }[];
};

const scalar = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : typeof v === 'number' || typeof v === 'boolean' ? v : null);
const labelOf = (id: string) => (id.split(':', 3).length === 3 ? id.split(':', 3)[1]!.slice(0, 64) : 'Unknown');
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** The gateway's traversal in the console's shape. */
export function graphFromGateway(payload: Wire): GraphTraverseResponse {
  const message = payload.errors?.[0]?.message;
  const g = payload.data?.graphTraverse;
  if (!g) throw new GatewayError(/node not found/i.test(message ?? '') ? 404 : 502, message ?? 'The data service returned no graph.');
  const nodes = (g.nodes ?? []) as Record<string, unknown>[];
  // A service that predates the privacy rules sends no properties field and would send raw identities: draw nothing.
  if (nodes.some((n) => !('properties' in n))) throw new GatewayError(502, 'The data service needs updating before the console can show its graph.');
  return {
    nodes: nodes.filter((n) => text(n.id) !== '').map((n) => {
      const id = text(n.id);
      const props = n.properties && typeof n.properties === 'object' ? (n.properties as Record<string, unknown>) : {};
      return {
        id,
        label: text(n.label) || labelOf(id),
        properties: Object.fromEntries(Object.entries(props).flatMap(([k, v]) => (scalar(v) === null ? [] : [[k, scalar(v)]]))),
      };
    }),
    edges: ((g.edges ?? []) as Record<string, unknown>[])
      .filter((e) => text(e.src) !== '' && text(e.dst) !== '')
      .map((e) => ({ src_id: text(e.src), dst_id: text(e.dst), edge_type: text(e.type).slice(0, 64) })),
    truncated: g.truncated === true,
  };
}

let csrfToken: Promise<string> | null = null;
const getCsrf = (fetchImpl: typeof fetch): Promise<string> => {
  csrfToken ??= fetchImpl(`${GEN3_API}/_status`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j: { csrf?: string }) => j?.csrf ?? '')
    .catch(() => '');
  return csrfToken;
};
export const forgetCsrf = () => { csrfToken = null; };
export const csrfHeader = async (fetchImpl: typeof fetch): Promise<Record<string, string>> => {
  const token = await getCsrf(fetchImpl);
  return token ? { 'X-CSRF-Token': token } : {};
};

/** One POST to the data API's GraphQL endpoint, with the session's CSRF token. */
export async function gatewayPost(
  fetchImpl: typeof fetch,
  body: { query: string; variables?: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<{ payload: unknown; privacy: boolean }> {
  const csrf = await getCsrf(fetchImpl);
  let res: Response;
  try {
    res = await fetchImpl(`${GEN3_GUPPY_API}/graphql`, {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new GatewayError(0, 'The data service could not be reached.');
  }
  if (res.status === 403) forgetCsrf();
  if (!res.ok) throw new GatewayError(res.status, `Request failed (${res.status})`);
  return { payload: await res.json().catch(() => ({})), privacy: res.headers.get('x-search-privacy') === '1' };
}

export async function traverseViaGateway(
  body: { start_id: string; max_hops?: number; limit?: number },
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<GraphTraverseResponse> {
  const { payload } = await gatewayPost(fetchImpl, {
    query: QUERY,
    variables: { startId: body.start_id, maxHops: body.max_hops ?? 2, limit: body.limit ?? 200 },
  }, signal);
  return graphFromGateway(sanitizeUntrusted(payload) as Wire);
}

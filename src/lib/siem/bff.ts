/**
 * Server side of the console's API: who may call it, and what may be forwarded.
 *
 * Rules (each has a test):
 *  - Login and the route's Arborist resource are required. A missing or empty authz config DENIES (fail closed).
 *  - Only routes in the shared table are forwarded; path segments are validated, never interpolated raw.
 *  - Identity sent upstream is the verified one. Client-supplied identity headers and the raw cookie are dropped.
 *  - Writes must come from this site (Origin check) and carry JSON.
 *  - Upstream failure detail is not passed to the browser.
 */
import type { NextApiRequest } from 'next';
import { getAccessToken, getLoginStatus } from '@/lib/auth/getLoginStatus';
import { fetchArboristResources } from '@/lib/auth/fetchAuthz';
import { getRouteConfig } from '@/lib/auth/arboristConfig';

export const CONSOLE_ROUTE_KEY = '/Security';
const SEGMENT = /^[A-Za-z0-9._:-]{1,128}$/;
// The user name goes into a request header, so it must be plain printable ASCII.
const USER = /^[!-~]([ -~]{0,254}[!-~])?$/; // printable ASCII, no leading/trailing space (header-safe, matches the backend)
export const UPSTREAM_TIMEOUT_MS = 25_000;
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const PERMISSION_CACHE_SECONDS = 30;

export type Access =
  | { ok: true; user: string; token: string }
  | { ok: false; status: 401 | 403; error: string };

export interface AuthDeps {
  loginStatus: typeof getLoginStatus;
  accessToken: typeof getAccessToken;
  resources: typeof fetchArboristResources;
  routeConfig: typeof getRouteConfig;
  production: boolean;
}

const defaults = (): AuthDeps => ({
  loginStatus: getLoginStatus,
  accessToken: getAccessToken,
  resources: fetchArboristResources,
  routeConfig: getRouteConfig,
  production: process.env.NODE_ENV === 'production',
});

export async function authorize(cookie: string | undefined, deps: AuthDeps = defaults(), routeKey: string = CONSOLE_ROUTE_KEY, userOrder: Array<'name' | 'email' | 'username'> = ['name', 'email', 'username']): Promise<Access> {
  const login = await deps.loginStatus(cookie ?? '');
  const token = deps.accessToken(cookie ?? '');
  if (login.status !== 'issued' || !token) return { ok: false, status: 401, error: 'Sign in required.' };

  let needed: string[];
  try {
    const rule = (await deps.routeConfig()).routes?.[routeKey];
    needed = Array.isArray(rule?.authz) ? (rule.authz as string[]) : [];
  } catch {
    needed = [];
  }
  if (needed.length === 0) return { ok: false, status: 403, error: 'Access is not configured.' };

  // A short cache lifetime keeps a revoked permission from lingering (the helper's default is 6 minutes).
  const granted = await deps.resources(token, deps.production, PERMISSION_CACHE_SECONDS);
  if (!needed.some((r) => granted.includes(r))) return { ok: false, status: 403, error: 'You do not have access to this data.' };

  const ctx = login.userContext ?? {};
  const user = userOrder.map((k) => ctx[k]).find((v) => typeof v === 'string' && USER.test(v)) as string | undefined;
  if (!user) return { ok: false, status: 401, error: 'Sign in required.' };
  return { ok: true, user, token };
}

export function validSegments(raw: string | string[] | undefined): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) return null;
  return raw.every((s) => typeof s === 'string' && SEGMENT.test(s) && s !== '.' && s !== '..') ? raw : null;
}

/**
 * Writes must originate from this site: same scheme, host and port as the request, and never a cross-site fetch.
 * GET is exempt (it changes nothing). `proto` is the scheme the browser used (x-forwarded-proto behind the load balancer).
 */
export function sameOrigin(method: string, origin: string | undefined, host: string | undefined, proto = 'https', fetchSite?: string): boolean {
  if (method === 'GET') return true;
  if (!origin || !host) return false;
  if (fetchSite !== undefined && fetchSite !== 'same-origin') return false;
  try {
    return new URL(origin).origin === `${proto}://${host}`;
  } catch {
    return false;
  }
}

type Env = Record<string, string | undefined>;
/** Fail closed: only NODE_ENV exactly 'development' or 'test' relaxes anything. Unset or any other value is production. */
export const isProduction = (env: Env = process.env): boolean => env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test';

/** The scheme the browser used: x-forwarded-proto behind the load balancer, else https outside development. */
export function requestProto(headers: Record<string, string | string[] | undefined>): 'http' | 'https' {
  const f = String(headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  return f === 'http' || f === 'https' ? f : isProduction() ? 'https' : 'http';
}

/** Same-origin check for a write request, from the request's own headers. */
export function writeAllowed(req: NextApiRequest, method: string): boolean {
  const fetchSite = typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : undefined;
  return sameOrigin(method, req.headers.origin, req.headers.host, requestProto(req.headers), fetchSite);
}

export function upstreamBase(): string {
  if (process.env.SIEM_SERVICE_URL) return process.env.SIEM_SERVICE_URL.replace(/\/+$/, '');
  if (process.env.SIEM_SERVICE_DNS) return `http://${process.env.SIEM_SERVICE_DNS}:8000`;
  return 'http://siem-service.gen3.svc.cluster.local:8000';
}

/** Headers sent upstream: built from scratch, never copied from the browser request. */
export function upstreamHeaders(access: { user: string; token: string }, hasBody: boolean): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: `Bearer ${access.token}`,
    'x-auth-request-user': access.user,
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
  };
}

/** What the browser is told about an upstream error: 4xx keeps a short message, 5xx is generic. */
export function publicError(status: number, payload: unknown): { status: number; body: { error: string } } {
  if (status >= 500) return { status: 502, body: { error: 'The security service returned an error.' } };
  const p = payload as { error?: unknown; detail?: unknown } | null;
  const msg = typeof p?.error === 'string' ? p.error : typeof p?.detail === 'string' ? p.detail : `Request failed (${status}).`;
  return { status, body: { error: msg.slice(0, 300) } };
}

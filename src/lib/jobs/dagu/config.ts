/**
 * Where Dagu is and how the portal authenticates to it. Server-side only; nothing here is ever returned or logged.
 *
 *   DAGU_URL                    root of the Dagu server, e.g. https://dagu.example.org (a trailing /api/v1 is accepted and removed)
 *   DAGU_TOKEN                  Bearer token (a Dagu API key, builtin auth)            \ exactly one of these
 *   DAGU_BASIC_USER / _PASSWORD HTTP Basic credentials (basic auth mode)               /
 *   DAGU_ALLOW_CLUSTER_HTTP=yes permits plain http, in production, ONLY for a cluster-local host (*.svc, *.svc.cluster.local)
 *                               or a host named EXACTLY in DAGU_HTTP_HOSTS (comma list, e.g. `dagu,dagu.svc.local` for a docker/compose
 *                               service name); never an IP address, never a wildcard
 *
 * https is required in production (isProduction(): anything but NODE_ENV development/test). No credentials in the url, no
 * query/fragment, and redirects are never followed (the credential is attached to the request).
 */
import { isProduction } from '../portal';

type Env = Record<string, string | undefined>;
export interface DaguTarget { base: string; authorization: string }

const HEADER_SAFE = /^[\x21-\x7e]{1,512}$/; // printable ASCII, no space: cannot break a header line
const isClusterLocal = (host: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.svc(\.cluster\.local)?$/.test(host) && host.split('.').length >= 3;
const PRIVATE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?){0,5}$/;
const looksLikeIp = (host: string): boolean => /^[0-9.]+$/.test(host) || host.includes(':') || /^[0-9a-f]+$/i.test(host.replace(/\./g, '')) && /\d/.test(host) && !/[g-z-]/i.test(host);
/** Exactly-named private hosts the operator has listed (a docker/compose service name, `dagu.svc.local`, ...). */
const listedPrivateHost = (host: string, env: Env): boolean => {
  if (!PRIVATE_NAME.test(host) || looksLikeIp(host)) return false;
  return (env.DAGU_HTTP_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
};

export function daguTarget(env: Env = process.env): DaguTarget | null {
  const raw = env.DAGU_URL?.trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'https:') { /* always fine */ }
  else if (u.protocol === 'http:') {
    if (isProduction(env) && !(env.DAGU_ALLOW_CLUSTER_HTTP === 'yes' && (isClusterLocal(host) || listedPrivateHost(host, env)))) return null;
  } else return null;
  const base = `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}`;

  const token = env.DAGU_TOKEN;
  const user = env.DAGU_BASIC_USER;
  const pass = env.DAGU_BASIC_PASSWORD;
  const haveToken = !!token?.trim();
  const haveBasic = !!user || !!pass;
  if (haveToken === haveBasic) return null; // none, or both: ambiguous, refuse
  if (haveToken) return HEADER_SAFE.test(token as string) ? { base, authorization: `Bearer ${token}` } : null;
  if (!user || !pass || user.includes(':') || !/^[\x20-\x7e]{1,256}$/.test(user) || !/^[\x20-\x7e]{1,512}$/.test(pass)) return null;
  return { base, authorization: `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}` };
}

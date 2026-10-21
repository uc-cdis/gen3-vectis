/**
 * Where Dagu is and how the portal authenticates to it. Server-side only; nothing here is ever returned or logged.
 *
 *   DAGU_URL                    root of the Dagu server, e.g. https://dagu.example.org (a trailing /api/v1 is accepted and removed)
 *   DAGU_TOKEN                  Bearer token (a Dagu API key, builtin auth)            \ exactly one of these
 *   DAGU_BASIC_USER / _PASSWORD HTTP Basic credentials (basic auth mode)               /
 *   DAGU_AUTH=serviceaccount    none of the above: this pod's own Kubernetes service-account token is sent as the Bearer, and a gate in
 *                               front of Dagu (dagu-gate) verifies it and adds Dagu's credential. No Dagu credential is held here. Only
 *                               for a cluster-local host, so the token is never sent anywhere else. DAGU_SA_TOKEN_FILE overrides the path.
 *   DAGU_ALLOW_CLUSTER_HTTP=yes permits plain http, in production, ONLY for a cluster-local host (*.svc, *.svc.cluster.local)
 *                               or a host named EXACTLY in DAGU_HTTP_HOSTS (comma list, e.g. `dagu,dagu.svc.local` for a docker/compose
 *                               service name); never an IP address, never a wildcard
 *
 * https is required in production (isProduction(): anything but NODE_ENV development/test). No credentials in the url, no
 * query/fragment, and redirects are never followed (the credential is attached to the request).
 */
import { isProduction } from '../portal';
import { isClusterLocal, listedPrivateHost, podToken } from '../cluster';

type Env = Record<string, string | undefined>;
export interface DaguTarget { base: string; authorization: string }

const HEADER_SAFE = /^[\x21-\x7e]{1,512}$/; // printable ASCII, no space: cannot break a header line

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

  if (env.DAGU_AUTH === 'serviceaccount') {
    // the pod's token goes to a cluster-local Dagu only, and never alongside another credential
    if (env.DAGU_TOKEN || env.DAGU_BASIC_USER || env.DAGU_BASIC_PASSWORD) return null;
    if (!(isClusterLocal(host) || listedPrivateHost(host, env))) return null;
    const tok = podToken(env);
    return tok ? { base, authorization: `Bearer ${tok}` } : null;
  }
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

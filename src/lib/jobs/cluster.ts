/**
 * Rules for talking to a service inside the cluster with this pod's own identity, shared by every server-side client that does it
 * (the Dagu runner, the catalog). The pod's service-account token is only ever sent to a cluster-local host, or one the operator
 * listed by exact name in DAGU_HTTP_HOSTS, so it can never go anywhere else.
 */
import { readFileSync } from 'node:fs';

type Env = Record<string, string | undefined>;

export const isClusterLocal = (host: string): boolean => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.svc(\.cluster\.local)?$/.test(host) && host.split('.').length >= 3;
const PRIVATE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?){0,5}$/;
const looksLikeIp = (host: string): boolean => /^[0-9.]+$/.test(host) || host.includes(':') || /^[0-9a-f]+$/i.test(host.replace(/\./g, '')) && /\d/.test(host) && !/[g-z-]/i.test(host);
/** Exactly-named private hosts the operator has listed (a docker/compose service name, `dagu.svc.local`, ...). Never an IP, never a wildcard. */
export const listedPrivateHost = (host: string, env: Env): boolean => {
  if (!PRIVATE_NAME.test(host) || looksLikeIp(host)) return false;
  return (env.DAGU_HTTP_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
};

const TOKEN_SAFE = /^[\x21-\x7e]{1,4096}$/; // a Kubernetes service-account token is a JWT of about 1000 characters; no space, so it cannot break a header

/** This pod's own service-account token (read fresh each time: it rotates), or null when it cannot be read or is not header-safe. DAGU_SA_TOKEN_FILE overrides the path. */
export function podToken(env: Env): string | null {
  try {
    const tok = readFileSync(env.DAGU_SA_TOKEN_FILE || '/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8').trim();
    return TOKEN_SAFE.test(tok) ? tok : null;
  } catch { return null; }
}

/**
 * The base URL of an in-cluster service we call with the pod token, or null. Plain http only, and only to a cluster-local host or a
 * host listed in DAGU_HTTP_HOSTS (and in production only with DAGU_ALLOW_CLUSTER_HTTP=yes); no credentials, query or fragment in the URL.
 */
export function clusterBase(raw: string | undefined, env: Env, production: boolean): string | null {
  const u = (() => { try { return new URL((raw ?? '').trim()); } catch { return null; } })();
  if (!u || u.protocol !== 'http:' || u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (!(isClusterLocal(host) || listedPrivateHost(host, env))) return null;
  if (production && env.DAGU_ALLOW_CLUSTER_HTTP !== 'yes') return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

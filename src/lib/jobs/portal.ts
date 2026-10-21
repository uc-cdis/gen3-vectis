/**
 * Runner-independent gates for the Jobs portal API. Reuses the console's hardened pieces (login + Arborist route key,
 * fail closed, 30s permission cache, same-origin writes).
 *
 * Authorization layers: (1) the portal gates /Jobs (read) and /Jobs/submit (create/cancel); (2) the runner enforces
 * per-user access (TES: gen3-workflow from the user's own bearer).
 */
import type { NextApiResponse } from 'next';
import { authorize, isProduction, requestProto, sameOrigin, writeAllowed, MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS, type Access } from '@/lib/siem/bff';
import { getRouteConfig } from '@/lib/auth/arboristConfig';
import { RunnerConfigError, RunnerError } from './runner';

export { isProduction, requestProto, sameOrigin, writeAllowed, MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS };
export type { Access };
export const JOBS_READ_KEY = '/Jobs';
export const JOBS_SUBMIT_KEY = '/Jobs/submit';

type Env = Record<string, string | undefined>;
export type Level = 'read' | 'submit';
/**
 * The identity a run is stamped with. In a Fence access token `context.user.name` is the Fence USERNAME (unique, stable, always
 * present; the human name is `display_name`), while `email` comes from the identity provider and is sometimes empty. So with
 * the Dagu runner, where the identity decides who may see a run, the username comes first, then email. With the TES runner
 * the order is email, username, name (it is only a label there). A user with none of them gets 401 (fail closed).
 */
export const identityOrder = (env: Env = process.env): Array<'email' | 'username' | 'name'> => ((env.JOBS_RUNNER ?? '').trim() === 'dagu' ? ['name', 'email', 'username'] : ['email', 'username', 'name']);
/** May this user start jobs of a profile? The route `/Jobs/profile/<name>` in authz.json names the Arborist resource; with none configured the answer is no. */
export const authorizeJobProfile = (cookie: string | undefined, name: string): Promise<Access> =>
  /^[a-z][a-z0-9-]{0,31}$/.test(name)
    ? authorize(cookie, undefined, `/Jobs/profile/${name}`, identityOrder())
    : Promise.resolve({ ok: false, status: 403, error: 'Access is not configured.' });
/**
 * The groups this user may run jobs as, and whose runs they may see. A group is a route `/Jobs/group/<name>` in authz.json, which names the
 * Arborist resource that makes someone a member; only groups configured there exist, and each is checked with the same gate as the profiles.
 */
const GROUP_ROUTE = '/Jobs/group/';
const MAX_GROUPS = 8;
export async function allowedJobGroups(cookie: string | undefined): Promise<string[]> {
  let names: string[];
  try {
    const routes = (await getRouteConfig()).routes ?? {};
    names = Object.keys(routes).filter((k) => k.startsWith(GROUP_ROUTE)).map((k) => k.slice(GROUP_ROUTE.length)).filter((n) => /^[a-z][a-z0-9-]{0,31}$/.test(n)).sort().slice(0, MAX_GROUPS);
  } catch { return []; }
  const checks = await Promise.all(names.map((n) => authorize(cookie, undefined, `${GROUP_ROUTE}${n}`, identityOrder())));
  return names.filter((_n, i) => checks[i].ok);
}
export const authorizeJobs = (cookie: string | undefined, level: Level): Promise<Access> =>
  authorize(cookie, undefined, level === 'submit' ? JOBS_SUBMIT_KEY : JOBS_READ_KEY, identityOrder());

/** Map anything a runner (or runner selection) throws to a safe response. Nothing from the error is echoed except RunnerError's public message. */
export function sendFailure(res: NextApiResponse, e: unknown): void {
  if (e instanceof RunnerError) { res.status(e.status).json({ error: e.message, ...(e.details.length ? { details: e.details } : {}) }); return; }
  if (e instanceof RunnerConfigError) { res.status(500).json({ error: 'The jobs runner is misconfigured (unknown runner).' }); return; }
  res.status(500).json({ error: 'The jobs service had a problem.' });
}

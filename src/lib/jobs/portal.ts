/**
 * Runner-independent gates for the Jobs portal API. Reuses the console's hardened pieces (login + Arborist route key,
 * fail closed, 30s permission cache, same-origin writes).
 *
 * Authorization layers: (1) the portal gates /Jobs (read) and /Jobs/submit (create/cancel); (2) the runner enforces
 * per-user access (TES: gen3-workflow from the user's own bearer).
 */
import type { NextApiResponse } from 'next';
import { authorize, isProduction, requestProto, sameOrigin, writeAllowed, MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS, type Access } from '@/lib/siem/bff';
import { RunnerConfigError, RunnerError } from './runner';

export { isProduction, requestProto, sameOrigin, writeAllowed, MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS };
export type { Access };
export const JOBS_READ_KEY = '/Jobs';
export const JOBS_SUBMIT_KEY = '/Jobs/submit';

type Env = Record<string, string | undefined>;
export type Level = 'read' | 'submit';
/**
 * The identity a run is stamped with. email, then username; the display NAME only for the TES runner (it is a label there).
 * With the Dagu runner the identity decides who may see a run, and a display name is neither unique nor stable, so it is
 * never used: a user with neither email nor username gets 401 (fail closed).
 */
export const identityOrder = (env: Env = process.env): Array<'email' | 'username' | 'name'> => ((env.JOBS_RUNNER ?? '').trim() === 'dagu' ? ['email', 'username'] : ['email', 'username', 'name']);
export const authorizeJobs = (cookie: string | undefined, level: Level): Promise<Access> =>
  authorize(cookie, undefined, level === 'submit' ? JOBS_SUBMIT_KEY : JOBS_READ_KEY, identityOrder());

/** Map anything a runner (or runner selection) throws to a safe response. Nothing from the error is echoed except RunnerError's public message. */
export function sendFailure(res: NextApiResponse, e: unknown): void {
  if (e instanceof RunnerError) { res.status(e.status).json({ error: e.message, ...(e.details.length ? { details: e.details } : {}) }); return; }
  if (e instanceof RunnerConfigError) { res.status(500).json({ error: 'The jobs runner is misconfigured (unknown runner).' }); return; }
  res.status(500).json({ error: 'The jobs service had a problem.' });
}

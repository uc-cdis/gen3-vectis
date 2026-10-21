/**
 * Job profiles: what a reviewed catalog workflow may run AS. A profile is chosen by the catalog entry (`profile: <name>`), never by the
 * person starting the job, and never by a pasted workflow (those always run as the default, permissionless service account).
 * The operator defines the table in DAGU_K8S_PROFILES (JSON); each entry names:
 *   service_account  a service account in the jobs namespace (DAGU_K8S_NAMESPACE). Give it an IAM role (IRSA) for AWS access.
 *   env              plain settings the job pod gets as environment variables (names RUNNER_*; for example where a notebook runner reads
 *                    its notebooks from and writes results to). Only here, never from a definition, so a definition cannot redirect them.
 *   user_token       true: the job pod is annotated gen3username=<the verified user>, so the Gen3 workspace token service hands it
 *                    that user's own token (Gen3Auth() with no arguments), exactly as it does for a Jupyter pod.
 * Who may start a profile's jobs is a separate permission: the route `/Jobs/profile/<name>` in authz.json (fail closed when absent).
 * Example:  {"aws-audit":{"service_account":"job-aws-audit"},"as-user":{"service_account":"dagu-runner","user_token":true}}
 */
export interface JobProfile { name: string; service_account: string; user_token: boolean; env: Array<{ name: string; value: string }> }

type Env = Record<string, string | undefined>;
export const PROFILE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const K8S_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const ENV_NAME = /^RUNNER_[A-Z0-9_]{1,40}$/;
const ENV_VALUE = /^[A-Za-z0-9._:/@+=,%~-]{1,300}$/;

/** The configured profiles. An invalid table yields none (fail closed): a profile job is then refused, an ordinary job still runs. */
export function jobProfiles(env: Env = process.env): Map<string, JobProfile> {
  const out = new Map<string, JobProfile>();
  const raw = env.DAGU_K8S_PROFILES?.trim();
  if (!raw) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return new Map(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
  for (const [name, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PROFILE_NAME.test(name) || !v || typeof v !== 'object' || Array.isArray(v)) return new Map();
    const o = v as Record<string, unknown>;
    const extra = Object.keys(o).filter((k) => k !== 'service_account' && k !== 'user_token' && k !== 'env');
    if (typeof o.service_account !== 'string' || !K8S_NAME.test(o.service_account) || extra.length || (o.user_token !== undefined && typeof o.user_token !== 'boolean')) return new Map();
    const env: Array<{ name: string; value: string }> = [];
    if (o.env !== undefined) {
      if (!o.env || typeof o.env !== 'object' || Array.isArray(o.env) || Object.keys(o.env).length > 16) return new Map();
      for (const [k, val] of Object.entries(o.env as Record<string, unknown>)) {
        if (!ENV_NAME.test(k) || typeof val !== 'string' || !ENV_VALUE.test(val)) return new Map();
        env.push({ name: k, value: val });
      }
    }
    out.set(name, { name, service_account: o.service_account, user_token: o.user_token === true, env });
  }
  return out;
}

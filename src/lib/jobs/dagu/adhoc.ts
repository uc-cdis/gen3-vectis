import { createHash } from 'node:crypto';
import type { LaunchSpec } from '../launch';
import { lintDaguDefinition } from './lint';

/** A workflow pasted into the portal instead of read from the catalog. Server-side only. */
export const MAX_ADHOC_BYTES = 64 * 1024;
export type AdhocResult =
  | { ok: true; spec: LaunchSpec; name: string; steps: number; sha: string }
  | { ok: false; errors: string[] };

/**
 * Limits that apply to a PASTED workflow only. A reviewed catalog job is checked by its reviewers; a pasted one is checked by nobody, so
 * it may not spend more than a person could plausibly need or reach outside the platform by e-mail.
 */
export const ADHOC_LIMITS = { retries: 5, intervalSec: 3600, timeoutSec: 86_400, backoff: 10, activeSteps: 16 } as const;
const RETRY_KEYS = new Set(['limit', 'interval_sec', 'backoff', 'max_interval_sec', 'exit_code']);
type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Problems with a pasted workflow that the shared lint allows (it is also used for reviewed catalog jobs). Empty when it is fine. */
export function adhocProblems(doc: Obj, executors: readonly string[]): string[] {
  const errs: string[] = [];
  // No e-mail: the server's mail relay would send anything, to anyone, from any address.
  if (executors.some((e) => e.toLowerCase().split('.')[0] === 'mail')) errs.push('mail: a pasted workflow cannot send e-mail; add the job to the catalog, where it is reviewed');
  const whole = (v: unknown, max: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
  if (doc.timeout_sec !== undefined && !whole(doc.timeout_sec, ADHOC_LIMITS.timeoutSec)) errs.push(`timeout_sec: a whole number of seconds, at most ${ADHOC_LIMITS.timeoutSec}`);
  if (doc.max_active_steps !== undefined && !(whole(doc.max_active_steps, ADHOC_LIMITS.activeSteps) && doc.max_active_steps !== 0)) errs.push(`max_active_steps: 1 to ${ADHOC_LIMITS.activeSteps}`);
  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  steps.forEach((s, i) => {
    if (!isObject(s)) return;
    const at = `steps[${i}]`;
    if (s.timeout_sec !== undefined && !whole(s.timeout_sec, ADHOC_LIMITS.timeoutSec)) errs.push(`${at}.timeout_sec: a whole number of seconds, at most ${ADHOC_LIMITS.timeoutSec}`);
    const r = s.retry_policy;
    if (r === undefined) return;
    if (!isObject(r)) { errs.push(`${at}.retry_policy: must be a mapping`); return; }
    for (const k of Object.keys(r)) if (!RETRY_KEYS.has(k)) errs.push(`${at}.retry_policy.${k}: not allowed`);
    if (r.limit !== undefined && !whole(r.limit, ADHOC_LIMITS.retries)) errs.push(`${at}.retry_policy.limit: at most ${ADHOC_LIMITS.retries} retries`);
    for (const k of ['interval_sec', 'max_interval_sec'] as const) if (r[k] !== undefined && !whole(r[k], ADHOC_LIMITS.intervalSec)) errs.push(`${at}.retry_policy.${k}: at most ${ADHOC_LIMITS.intervalSec} seconds`);
    if (r.backoff !== undefined && !(typeof r.backoff === 'number' && r.backoff >= 1 && r.backoff <= ADHOC_LIMITS.backoff)) errs.push(`${at}.retry_policy.backoff: between 1 and ${ADHOC_LIMITS.backoff}`);
  });
  return errs;
}

/**
 * The same lint a catalog definition gets (executor allowlist, image policy, no host side effects, no literal secrets), with this
 * server's own environment. The runner lints the text again before it reaches Dagu and sends Dagu a re-serialised copy of the parsed
 * object, so what was checked is what runs. A pasted workflow has no catalog commit: it is tagged `vectis.job=adhoc` and carries a hash
 * of its text so a run can be matched to exactly what was submitted. Parameter values are not accepted from the browser for a pasted
 * workflow; whatever its own `params:` declare keep their literal defaults.
 */
export function compileAdhocDag(text: unknown, env: Record<string, string | undefined> = process.env): AdhocResult {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, errors: ['paste a workflow definition'] };
  if (Buffer.byteLength(text, 'utf8') > MAX_ADHOC_BYTES) return { ok: false, errors: ['the definition is larger than 64KB'] };
  const lint = lintDaguDefinition(text, { env, catalogParams: [], fallbackName: 'adhoc' });
  if (!lint.ok) return { ok: false, errors: lint.errors };
  // A pasted workflow gets no secrets. `secrets:` is the only way a definition can read the Dagu server's environment, and anyone allowed to
  // paste could otherwise send an operator-provided secret to a host of their choice. A job that needs a secret goes in the reviewed catalog.
  const declared = (lint.info.doc as Record<string, unknown>).secrets;
  if (Array.isArray(declared) ? declared.length > 0 : declared !== undefined) {
    return { ok: false, errors: ['secrets: a pasted workflow cannot use secrets; add the job to the catalog, where it is reviewed'] };
  }
  const extra = adhocProblems(lint.info.doc as Record<string, unknown>, lint.info.steps.map((s) => s.executor));
  if (extra.length) return { ok: false, errors: extra };
  const name = lint.info.name ?? 'adhoc';
  const sha = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 40);
  return {
    ok: true, name, steps: lint.info.steps.length, sha,
    spec: {
      name,
      dag: { engine: 'dagu', definition: text, dag_name: name, params: {} },
      steps: [], inputs: [], outputs: [],
      tags: { 'vectis.job': 'adhoc', 'vectis.catalog_repo': 'pasted', 'vectis.catalog_sha': sha },
      secrets: [], warnings: ['This workflow was pasted, not read from the job catalog.'],
    },
  };
}

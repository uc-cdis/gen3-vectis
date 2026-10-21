import { createHash } from 'node:crypto';
import type { LaunchSpec } from '../launch';
import { MAX_ADHOC_BYTES } from '../dagu/adhoc';
import { parseJobDef } from './parse';
import { compileJob } from './compile';
import { usesUserBucket } from './templates';

export type AdhocJobResult =
  | { ok: true; spec: LaunchSpec; name: string; steps: number; sha: string }
  | { ok: false; errors: string[] };

/**
 * A container job pasted in the catalog's own job-definition format (TES runner). It goes through the same parser, lint and compiler a
 * catalog definition does, with the user's parameter values checked against the types it declares. It is tagged `vectis.job=adhoc`
 * whatever `id` it declares, so a pasted job can never look like a catalog job, and carries a hash of its text.
 * `bucket` is asked for only when the definition uses {{user_bucket}}.
 */
export async function compileAdhocJob(text: unknown, params: Record<string, unknown>, bucket: () => Promise<string | undefined>): Promise<AdhocJobResult> {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, errors: ['paste a job definition'] };
  if (Buffer.byteLength(text, 'utf8') > MAX_ADHOC_BYTES) return { ok: false, errors: ['the definition is larger than 64KB'] };
  const parsed = parseJobDef(text);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const sha = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 40);
  const userBucket = usesUserBucket(parsed.def) ? await bucket() : undefined;
  const c = compileJob(parsed.def, params, { repo: 'pasted/adhoc', sha, userBucket });
  if (!c.ok) return { ok: false, errors: c.errors };
  const spec: LaunchSpec = {
    ...c.spec,
    tags: { ...c.spec.tags, 'vectis.job': 'adhoc' },
    warnings: [...c.spec.warnings, 'This job was pasted, not read from the job catalog.'],
  };
  return { ok: true, spec, name: parsed.def.name, steps: spec.steps.length, sha };
}

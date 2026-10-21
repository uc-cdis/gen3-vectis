import { createHash } from 'node:crypto';
import type { LaunchSpec } from '../launch';
import { lintDaguDefinition } from './lint';

/** A workflow pasted into the portal instead of read from the catalog. Server-side only. */
export const MAX_ADHOC_BYTES = 64 * 1024;
export type AdhocResult =
  | { ok: true; spec: LaunchSpec; name: string; steps: number; sha: string }
  | { ok: false; errors: string[] };

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

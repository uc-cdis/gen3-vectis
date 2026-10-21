import type { LaunchSpec, LaunchStep } from '../launch';
import { hasDotDot, URL_SAFE_SEGMENT } from '../urls';
import { toTesTask } from '../tes/adapter';
import { validateTaskSubmission } from '../tes/validate';
import type { CompileContext, CompileResult, DagJobDef, JobDef, JobParam } from './types';
import { checkDagParam, checkSecretValue } from '../dagu/params';
import { BUILTIN_USER_BUCKET, isWholeToken, tokenRe } from './templates';
import { checkParam } from './params';
import { lintTask, secretRefsIn } from './lint';

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const VERSION = /^[A-Za-z0-9._"/=+-]{1,128}$/; // commit sha, or an S3 VersionId / ETag
// The bucket name itself comes from /storage/setup; this only keeps it from changing the shape of a URL.
const BUCKET_SAFE = /^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$/;

type Ctx = 'argv' | 'env' | 'url';

/** Substitute tokens in ONE pass; replaced text is never scanned again. */
function substitute(tpl: string, where: string, ctx: Ctx, params: Map<string, JobParam>, values: Map<string, string>, c: CompileContext, errs: string[]): string {
  const whole = isWholeToken(tpl);
  return tpl.replace(tokenRe(), (_m, name: string) => {
    if (name === BUILTIN_USER_BUCKET) {
      if (ctx !== 'url') { errs.push(`${where}: {{${name}}} not allowed here`); return ''; }
      if (!c.userBucket || !BUCKET_SAFE.test(c.userBucket)) { errs.push(`${where}: your storage bucket is not available`); return ''; }
      return c.userBucket;
    }
    const p = params.get(name);
    if (!p) { errs.push(`${where}: undeclared placeholder {{${name}}}`); return ''; }
    const v = values.get(name);
    if (v === undefined) { errs.push(`${where}: parameter "${name}" has no value`); return ''; }
    if (ctx === 'argv' && whole === name && v.startsWith('-') && !p.allow_leading_dash) {
      errs.push(`${where}: value of "${name}" may not start with "-"`); return '';
    }
    if (ctx === 'url') {
      const isUrlParam = p.type === 's3_url' || p.type === 'http_url';
      if (isUrlParam) { if (whole !== name) { errs.push(`${where}: url params must fill the whole url`); return ''; } }
      else if (!URL_SAFE_SEGMENT.test(v) || hasDotDot(v)) { errs.push(`${where}: value of "${name}" has characters not allowed in a url`); return ''; }
    }
    return v;
  });
}

/**
 * Compile a (parsed, linted) definition plus user parameters into ONE runner-neutral LaunchSpec. This is the single
 * compiler: every runner receives its output. The portable limits and credential lint are enforced here by checking the
 * spec in its strictest common shape (the TES view of it, `toTesTask`), so a spec that passes is acceptable to any runner.
 * Parameters are validated against their declared type first. Fails closed: any problem gives {ok:false}.
 */
export function compileJob(def: JobDef, paramValues: Record<string, unknown>, ctx: CompileContext): CompileResult {
  const errs: string[] = [];
  if (!REPO.test(ctx.repo)) errs.push('catalog repo is invalid');
  if (!VERSION.test(ctx.sha)) errs.push('catalog version is invalid');
  const params = new Map((def.params ?? []).map((p) => [p.name, p] as const));
  const supplied = paramValues && typeof paramValues === 'object' && !Array.isArray(paramValues) ? paramValues : {};
  for (const k of Object.keys(supplied)) if (!params.has(k)) errs.push(`unknown parameter "${k.slice(0, 40)}"`);

  const values = new Map<string, string>();
  for (const p of params.values()) {
    const given = Object.prototype.hasOwnProperty.call(supplied, p.name) ? supplied[p.name] : undefined;
    const raw = given === undefined || given === null ? p.default : given;
    if (raw === undefined) { if (p.required) errs.push(`${p.name}: is required`); continue; }
    const c = checkParam(p, raw);
    if (c.ok) values.set(p.name, c.value); else errs.push(c.error);
  }
  if (errs.length) return { ok: false, errors: errs };

  const sub = (s: string, where: string, kind: Ctx) => substitute(s, where, kind, params, values, ctx, errs);
  const env = (e: Record<string, string> | undefined, where: string) =>
    e ? Object.fromEntries(Object.entries(e).map(([k, v]) => {
      const out = sub(v, `${where}.${k}`, 'env');
      // a secret reference may only come from a literal `secret://name` in the definition, never from substituted text
      if (out.startsWith('secret://') && v !== out) errs.push(`${where}.${k}: a parameter cannot produce a secret reference`);
      return [k, out];
    })) : undefined;
  const step = (image: string, command: string[], e: Record<string, string> | undefined, where: string, workdir?: string): LaunchStep => ({
    image, command: command.map((a, i) => sub(a, `${where}.command[${i}]`, 'argv')), ...(e ? { env: env(e, `${where}.env`) } : {}), ...(workdir ? { workdir } : {}),
  });

  const spec: LaunchSpec = {
    name: def.name,
    ...(def.description ? { description: def.description } : {}),
    steps: [
      step(def.image, def.command, def.env, 'executor', undefined),
      ...(def.executors_after ?? []).map((x, i) => step(x.image, x.command, x.env, `executors_after[${i}]`, x.workdir)),
    ],
    inputs: (def.inputs ?? []).map((x, i) => ({ name: x.name, ...(x.description ? { description: x.description } : {}), url: sub(x.url, `inputs[${i}].url`, 'url'), path: x.path, type: x.type ?? 'FILE' })),
    outputs: (def.outputs ?? []).map((x, i) => ({ name: x.name, ...(x.description ? { description: x.description } : {}), url: sub(x.url, `outputs[${i}].url`, 'url'), path: x.path, ...(x.path_prefix ? { path_prefix: x.path_prefix } : {}), type: x.type ?? 'FILE' })),
    ...(def.resources ? { resources: { ...def.resources } } : {}),
    tags: { 'vectis.job': def.id, 'vectis.catalog_sha': ctx.sha, 'vectis.catalog_repo': ctx.repo },
    secrets: [...(def.secrets ?? [])],
    warnings: [],
  };
  if (errs.length) return { ok: false, errors: errs };

  const task = toTesTask(spec);
  const v = validateTaskSubmission(task);
  if (!v.ok) return { ok: false, errors: v.errors };
  for (const i of lintTask(task, { allowSecretRefs: true, declaredSecrets: new Set(def.secrets ?? []) })) errs.push(`${i.path}: ${i.message}`);
  // a parameter must not be able to choose which secret is referenced
  for (const [name, val] of values) if (val.includes('secret://')) errs.push(`${name}: must not contain a secret reference`);
  if (errs.length) return { ok: false, errors: errs };

  const refs = secretRefsIn(task);
  if (refs.length || (def.secrets ?? []).length) spec.warnings.push('secret:// references are passed through unresolved; whether and how they are resolved depends on the runner and its backend.');
  if (def.timeout_seconds) spec.warnings.push(`timeout_seconds (${def.timeout_seconds}) is a hint only; not every runner enforces it (TES v1.1 has no timeout field).`);
  return { ok: true, spec };
}

/**
 * Compile a workflow-engine catalog entry plus user parameters into a LaunchSpec that carries the engine's NATIVE
 * definition unchanged (`spec.dag`). Every value passes the declared type check AND the strict "inert in a shell" check
 * (dagu/params.ts) because the engine substitutes parameters into step commands as text. The native text was linted at
 * catalog load; the runner lints it again. Fails closed.
 */
export function compileDagJob(def: DagJobDef, native: { text: string; dag_name: string }, paramValues: Record<string, unknown>, ctx: CompileContext): CompileResult {
  const errs: string[] = [];
  if (!REPO.test(ctx.repo)) errs.push('catalog repo is invalid');
  if (!VERSION.test(ctx.sha)) errs.push('catalog version is invalid');
  const params = new Map((def.params ?? []).map((p) => [p.name, p] as const));
  const supplied = paramValues && typeof paramValues === 'object' && !Array.isArray(paramValues) ? paramValues : {};
  for (const k of Object.keys(supplied)) if (!params.has(k)) errs.push(`unknown parameter "${k.slice(0, 40)}"`);
  const values: Record<string, string> = {};
  const secretEnv: Array<{ name: string; value: string }> = [];
  for (const p of params.values()) {
    const given = Object.prototype.hasOwnProperty.call(supplied, p.name) ? supplied[p.name] : undefined;
    if (p.type === 'secret') {
      // typed by the user for this run: never a parameter (those are saved with the run and shown on its page), only a pod environment variable
      if (given === undefined || given === null || given === '') { if (p.required) errs.push(`${p.name}: is required`); continue; }
      const c = checkSecretValue(p, given);
      if (c.ok && p.env) secretEnv.push({ name: p.env, value: c.value }); else if (!c.ok) errs.push(c.error);
      continue;
    }
    const raw = given === undefined || given === null ? p.default : given;
    if (raw === undefined) { if (p.required) errs.push(`${p.name}: is required`); continue; }
    const c = checkDagParam(p, raw);
    if (c.ok) values[p.name] = c.value; else errs.push(c.error);
  }
  if (errs.length) return { ok: false, errors: errs };
  return {
    ok: true,
    spec: {
      name: def.name,
      ...(def.description ? { description: def.description } : {}),
      dag: { engine: def.engine, definition: native.text, dag_name: native.dag_name, params: values, ...(def.profile ? { profile: def.profile } : {}), ...(secretEnv.length ? { secret_env: secretEnv } : {}) },
      steps: [], inputs: [], outputs: [],
      tags: { 'vectis.job': def.id, 'vectis.catalog_sha': ctx.sha, 'vectis.catalog_repo': ctx.repo, ...(def.profile ? { 'vectis.profile': def.profile } : {}) },
      secrets: [],
      warnings: [],
    },
  };
}

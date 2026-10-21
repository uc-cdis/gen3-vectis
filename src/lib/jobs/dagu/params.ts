/**
 * Parameters of a DAG job. Dagu substitutes `${params.x}` into a step's command TEXT before a shell parses it, so a value
 * is code unless it is provably inert. Two layers, both fail closed:
 *
 *  1. checkDagParam (compile time, knows the declared type):
 *       string                      strict allowlist charset, no leading '-' (unless allow_leading_dash), plus the declared pattern/length
 *       s3_url / http_url           the normal URL validation AND a shell-inert url charset (no quote, backtick, $, ; | & < > ( ) { } \ ! *)
 *       integer / number / boolean  inert by construction (re-serialised from a parsed number/boolean)
 *       enum                        the value must be one of the author's listed values, and the author's values must themselves be inert
 *                                   (checked at catalog load by `dagEnumProblems`)
 *  2. assertInertValues (runner, does not know the type): every value, whatever its type, must match the shell-inert url charset.
 *
 * Space, quotes, ; | & $ ` < > ( ) { } \ newline, NUL and every other control character are in neither charset.
 */
import { checkParam } from '../jobdef/params';
import type { JobParam } from '../jobdef/types';

/** Free text params: letters, digits and . _ : / @ + = , % - (no space, no quotes, no shell syntax). */
export const SAFE_STRING = /^[A-Za-z0-9._:/@+=,%-]*$/;
/** Values that are urls or numbers: SAFE_STRING plus ? # ~ (query/fragment/tilde); still no shell syntax. */
export const SAFE_VALUE = /^[A-Za-z0-9._:/@+=,%~?#-]*$/;

type DagParamCheck = { ok: true; value: string } | { ok: false; error: string };

export function checkDagParam(p: JobParam, raw: unknown): DagParamCheck {
  const c = checkParam(p, raw);
  if (!c.ok) return c;
  const fail = (m: string): DagParamCheck => ({ ok: false, error: `${p.name}: ${m}` });
  const v = c.value;
  switch (p.type) {
    case 'integer': case 'number': case 'boolean': return /^[A-Za-z0-9.-]{1,32}$/.test(v) ? c : fail('unexpected characters');
    case 'enum': return SAFE_VALUE.test(v) ? c : fail('is not a safe value');
    case 's3_url': case 'http_url':
      return SAFE_VALUE.test(v) ? c : fail('contains characters that are not allowed in a workflow parameter (no quotes, spaces, ; | & $ ` < > ( ) { } \\ ! *; percent-encode them)');
    default:
      if (!SAFE_STRING.test(v)) return fail('may only contain letters, digits and . _ : / @ + = , % - (no spaces, quotes or shell characters)');
      if (v.startsWith('-') && !p.allow_leading_dash) return fail('may not start with "-"');
      return c;
  }
}

/** Catalog-load check of an enum's listed values for a DAG job. */
export function dagEnumProblems(p: JobParam): string[] {
  return p.type === 'enum' ? (p.values ?? []).filter((v) => !SAFE_VALUE.test(v)).map((v) => `params.${p.name}: enum value "${v.slice(0, 30)}" has characters that are not allowed in a workflow parameter`) : [];
}

/** The runner's own last check (it does not know the declared type). Returns an error text or null. */
export function assertInertValues(params: Record<string, string>): string | null {
  const names = Object.keys(params);
  if (names.length > 32) return 'too many parameters';
  for (const k of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) return `parameter name "${k.slice(0, 30)}" is not allowed`;
    const v = params[k];
    if (typeof v !== 'string' || v.length > 4096) return `parameter "${k}" is not allowed`;
    if (!SAFE_VALUE.test(v)) return `parameter "${k}" contains characters that are not allowed in a workflow parameter`;
  }
  return null;
}

// ---- secret parameters ------------------------------------------------------------------------------------------------
// A `secret` param is a value the user types for ONE run (an API key). It is never a workflow parameter: those are saved with the run,
// shown on the run page and substituted into the command text. It is handed to the job pod as an environment variable by the runner,
// under a name the reviewed catalog entry chose, and nowhere else.

/** A secret's variable name: ends in a credential word, and cannot be one that steers the platform, the pod's identity or the runtime. */
const SECRET_ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}_(API_KEY|TOKEN|SECRET|PASSWORD)$/;
const SECRET_ENV_FORBIDDEN = /^(AWS_|RUNNER_|KUBERNETES_|GEN3|ACCESS_TOKEN$|LD_|PYTHON)/;
export const SECRET_VALUE = /^[A-Za-z0-9._~+/=:-]{8,512}$/;
const MAX_SECRET_ENV = 4;

export const secretEnvNameProblem = (name: unknown): string | null =>
  typeof name !== 'string' || !SECRET_ENV_NAME.test(name) ? 'must be UPPER_CASE and end in _API_KEY, _TOKEN, _SECRET or _PASSWORD'
    : SECRET_ENV_FORBIDDEN.test(name) ? 'is reserved for the platform' : null;

/** Catalog-load check of one `secret` param: only workflow jobs, a valid variable name used once, and none of the plain-parameter options. */
export function secretParamProblems(p: JobParam, dag: boolean, seen: Set<string>): string[] {
  const out: string[] = [];
  const at = `params.${p.name}`;
  if (!dag) return [`${at}: secret params are only for workflow jobs`];
  if (p.env === undefined) out.push(`${at}: a secret param needs env (the variable the job receives it in)`);
  else {
    const bad = secretEnvNameProblem(p.env);
    if (bad) out.push(`${at}: env ${bad}`);
    if (seen.has(p.env)) out.push(`${at}: env ${p.env} is used by another param`);
    seen.add(p.env);
  }
  if (seen.size > MAX_SECRET_ENV) out.push(`${at}: at most ${MAX_SECRET_ENV} secret params`);
  for (const k of ['default', 'pattern', 'values', 'min', 'max', 'max_length', 'allow_leading_dash'] as const) {
    if (p[k] !== undefined) out.push(`${at}: ${k} is not allowed on a secret param`);
  }
  return out;
}

type SecretCheck = { ok: true; value: string } | { ok: false; error: string };
/** The value the user typed. The message never repeats it. */
export function checkSecretValue(p: JobParam, raw: unknown): SecretCheck {
  if (typeof raw !== 'string' || !SECRET_VALUE.test(raw)) return { ok: false, error: `${p.name}: must be 8 to 512 characters: letters, digits and . _ ~ + / = : - (no spaces)` };
  return { ok: true, value: raw };
}

/** The runner's own last check of what it was handed to inject (it does not trust the caller). Returns an error text or null. */
export function assertSecretEnv(list: ReadonlyArray<{ name: string; value: string }> | undefined): string | null {
  if (list === undefined) return null;
  if (!Array.isArray(list) || list.length > MAX_SECRET_ENV) return 'too many secret values';
  const names = new Set<string>();
  for (const e of list) {
    if (!e || typeof e !== 'object' || secretEnvNameProblem(e.name) || typeof e.value !== 'string' || !SECRET_VALUE.test(e.value) || names.has(e.name)) return 'a secret value was refused';
    names.add(e.name);
  }
  return null;
}

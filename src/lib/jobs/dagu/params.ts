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

import type { DagJobDef, DagParseResult, JobDef, JobParam, ParseResult } from './types';
import { dagDefValidator, jobDefValidator } from './schema';
import { dagEnumProblems } from '../dagu/params';
import { BUILTIN_USER_BUCKET, hasStrayBraces, isWholeToken, shellPlaceholderViolations, tokensIn } from './templates';
import { checkParam, compilePattern, MAX_PATTERN_INPUT } from './params';
import { lintDef } from './lint';
import { sanitizeLabel } from '@/lib/safe-text';
import { MAX_JOBDEF_BYTES, parseYamlStrict } from './yamlStrict';

export { MAX_JOBDEF_BYTES };

/** Parse + validate + lint one job definition. Strict: unknown keys, aliases, merge keys, multi-docs and oversize input are errors. */
export function parseJobDef(yamlText: unknown): ParseResult {
  const y = parseYamlStrict(yamlText);
  if (!y.ok) return y;
  const data = y.data;

  const validate = jobDefValidator();
  if (!validate(data)) {
    return { ok: false, errors: (validate.errors ?? []).slice(0, 10).map((e) => sanitizeLabel(`${e.instancePath || '/'} ${e.message ?? 'is invalid'}${e.params && 'additionalProperty' in e.params ? `: ${String(e.params.additionalProperty).slice(0, 40)}` : ''}`, 200)) };
  }
  const def = data as unknown as JobDef;
  const errors = semanticErrors(def);
  for (const i of lintDef(def)) errors.push(`${i.path}: ${i.message}`);
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, def };
}

/** Checks of a `params:` list that do not depend on where the placeholders are used. Shared by container jobs and DAG jobs. */
function paramErrors(list: readonly JobParam[] | undefined): { errs: string[]; params: Map<string, JobParam> } {
  const errs: string[] = [];
  const params = new Map<string, JobParam>();
  for (const p of list ?? []) {
    if (params.has(p.name)) errs.push(`params.${p.name}: duplicate name`);
    params.set(p.name, p);
    if (p.name === BUILTIN_USER_BUCKET) errs.push(`params.${p.name}: name is reserved`);
    if (p.type === 'enum' && !p.values) errs.push(`params.${p.name}: enum needs values`);
    if (p.type !== 'enum' && p.values) errs.push(`params.${p.name}: values is only for enum`);
    if (p.pattern !== undefined) {
      if (p.type !== 'string') errs.push(`params.${p.name}: pattern is only for string params`);
      if ((p.max_length ?? 0) > MAX_PATTERN_INPUT) errs.push(`params.${p.name}: max_length must be <= ${MAX_PATTERN_INPUT} when a pattern is set`);
      const c = compilePattern(p.pattern);
      if ('error' in c) errs.push(`params.${p.name}: ${c.error}`);
    }
    if ((p.min !== undefined || p.max !== undefined) && p.type !== 'integer' && p.type !== 'number') errs.push(`params.${p.name}: min/max are only for numbers`);
    if (p.default !== undefined) {
      const c = checkParam(p, p.default);
      if (!c.ok) errs.push(`default ${c.error}`);
    }
  }
  return { errs, params };
}

function semanticErrors(def: JobDef): string[] {
  const { errs, params } = paramErrors(def.params);
  const check = (s: string, where: string, ctx: 'argv' | 'env' | 'url') => {
    if (ctx === 'env' && tokensIn(s).length > 0) {
      const head = s.slice(0, s.search(/\{\{/));
      if (head.length > 0 && ('secret://'.startsWith(head) || head.startsWith('secret:'))) errs.push(`${where}: placeholders cannot be mixed with a secret: prefix`);
    }
    if (hasStrayBraces(s)) errs.push(`${where}: malformed {{placeholder}}`);
    for (const t of tokensIn(s)) {
      if (t === BUILTIN_USER_BUCKET) { if (ctx !== 'url') errs.push(`${where}: {{${t}}} may only be used in input/output urls`); continue; }
      const p = params.get(t);
      if (!p) { errs.push(`${where}: undeclared placeholder {{${t}}}`); continue; }
      if (ctx === 'url' && (p.type === 's3_url' || p.type === 'http_url') && isWholeToken(s) !== t) errs.push(`${where}: url params must fill the whole url`);
    }
  };
  const noTokens = (s: string | undefined, where: string) => { if (s !== undefined && /\{\{|\}\}/.test(s)) errs.push(`${where}: placeholders are not allowed here`); };
  const argvOf = (cmd: string[], where: string) => {
    cmd.forEach((a, i) => check(a, `${where}[${i}]`, 'argv'));
    for (const i of shellPlaceholderViolations(cmd)) errs.push(`${where}[${i}]: placeholder in a program name or after a shell/inline-code interpreter is not allowed`);
  };
  noTokens(def.image, 'image');
  argvOf(def.command, 'command');
  for (const [k, v] of Object.entries(def.env ?? {})) check(v, `env.${k}`, 'env');
  (def.inputs ?? []).forEach((x, i) => { check(x.url, `inputs[${i}].url`, 'url'); noTokens(x.path, `inputs[${i}].path`); });
  (def.outputs ?? []).forEach((x, i) => {
    check(x.url, `outputs[${i}].url`, 'url'); noTokens(x.path, `outputs[${i}].path`); noTokens(x.path_prefix, `outputs[${i}].path_prefix`);
    if (/[*?[]/.test(x.path) && !x.path_prefix) errs.push(`outputs[${i}].path_prefix: required when path has wildcards`);
  });
  (def.executors_after ?? []).forEach((x, n) => {
    noTokens(x.image, `executors_after[${n}].image`); noTokens(x.workdir, `executors_after[${n}].workdir`);
    argvOf(x.command, `executors_after[${n}].command`);
    for (const [k, v] of Object.entries(x.env ?? {})) check(v, `executors_after[${n}].env.${k}`, 'env');
  });
  const names = new Set<string>();
  for (const x of [...(def.inputs ?? []), ...(def.outputs ?? [])]) { if (names.has(x.name)) errs.push(`name "${x.name.slice(0, 40)}" is used twice in inputs/outputs`); names.add(x.name); }
  return errs;
}

/** True when parsed YAML data is a workflow-engine catalog entry (`kind: dag`). Anything else goes through parseJobDef unchanged. */
export const isDagEntryData = (data: unknown): boolean => typeof data === 'object' && data !== null && !Array.isArray(data) && (data as { kind?: unknown }).kind !== undefined;

/** Validate a `kind: dag` entry (metadata + the path of the native file). The native file itself is linted by the loader. */
export function parseDagEntry(yamlText: unknown): DagParseResult {
  const y = parseYamlStrict(yamlText);
  if (!y.ok) return y;
  const validate = dagDefValidator();
  if (!validate(y.data)) {
    return { ok: false, errors: (validate.errors ?? []).slice(0, 10).map((e) => sanitizeLabel(`${e.instancePath || '/'} ${e.message ?? 'is invalid'}${e.params && 'additionalProperty' in e.params ? `: ${String(e.params.additionalProperty).slice(0, 40)}` : ''}`, 200)) };
  }
  const def = y.data as unknown as DagJobDef;
  const { errs } = paramErrors(def.params);
  for (const p of def.params ?? []) errs.push(...dagEnumProblems(p));
  if (def.definition.includes('..')) errs.push('definition: path may not contain ".."');
  return errs.length ? { ok: false, errors: errs.slice(0, 20) } : { ok: true, def };
}

/** Text -> parsed YAML data, for routing between the two entry kinds (same hardened reader). */
export function peekEntry(yamlText: unknown): { ok: true; data: unknown } | { ok: false; errors: string[] } { return parseYamlStrict(yamlText); }

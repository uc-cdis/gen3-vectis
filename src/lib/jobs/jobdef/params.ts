import type { JobParam } from './types';
import { isHttpsUrl, isS3Url } from '../urls';

const MAX_STRING_PARAM = 4096;
const DEFAULT_MAX_LEN = 256;
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export const MAX_PATTERN_INPUT = 256;
const MAX_QUANTIFIERS = 8;
const MAX_COST = 1_000_000; // product of how many ways each quantifier can match (unbounded counts as 256)
const MAX_UNBOUNDED = 2;

/**
 * Backtracking-safety check for a declared pattern. JS has no linear-time engine here, so we only accept a small, simple subset:
 * at most 2 unbounded quantifiers (* + {n,}), at most 8 quantifiers in total, no quantified group (this also rules out
 * alternation inside a quantified group), no backreferences, no lookaround.
 */
function patternProblem(inner: string): string | null {
  let unbounded = 0;
  let total = 0;
  let cost = 1;
  const quant = (q: 'u' | 'b', ways: number) => { total += 1; cost *= ways; if (q === 'u') unbounded += 1; };
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\') {
      if (/[1-9k]/.test(inner[i + 1] ?? '')) return 'backreferences are not allowed';
      i += 1; continue;
    }
    if (c === '[') { // character class: skip to the closing bracket
      i += 1;
      while (i < inner.length && inner[i] !== ']') i += inner[i] === '\\' ? 2 : 1;
      continue;
    }
    if (c === '(') {
      if (inner[i + 1] === '?') { if (inner.slice(i, i + 3) !== '(?:') return 'only plain (...) and (?:...) groups are allowed'; i += 2; }
      continue;
    }
    let q: 'u' | 'b' | null = null;
    let len = 1;
    let ways = 2;
    if (c === '*' || c === '+') { q = 'u'; ways = MAX_PATTERN_INPUT; }
    else if (c === '?') q = 'b';
    else if (c === '{') {
      const m = /^\{(\d{1,3})(,(\d{0,3}))?\}/.exec(inner.slice(i));
      if (m) { q = m[2] !== undefined && m[3] === '' ? 'u' : 'b'; len = m[0].length; ways = q === 'u' ? MAX_PATTERN_INPUT : m[2] === undefined ? 1 : Math.max(1, Number(m[3]) - Number(m[1]) + 1); }
    }
    if (q) {
      quant(q, ways);
      if (inner[i + len] === '?') len += 1; // lazy modifier
      if (/[*+?{]/.test(inner[i + len] ?? '') && /^(\*|\+|\?|\{\d)/.test(inner.slice(i + len))) return 'stacked quantifiers are not allowed';
      i += len - 1;
      continue;
    }
    if (c === ')') {
      const next = inner.slice(i + 1);
      if (/^(\*|\+|\?|\{\d)/.test(next)) return 'quantified groups are not allowed';
    }
  }
  if (unbounded > MAX_UNBOUNDED) return `at most ${MAX_UNBOUNDED} unbounded quantifiers (* + {n,}); use {m,n}`;
  if (total > MAX_QUANTIFIERS) return `at most ${MAX_QUANTIFIERS} quantifiers`;
  if (cost > MAX_COST) return 'quantifiers are too open-ended (narrow the {m,n} ranges)';
  return null;
}

/** Turn a declared `pattern` (^...$) into a really-anchored RegExp, or an error. */
export function compilePattern(p: string): { re: RegExp } | { error: string } {
  if (p.length > 128) return { error: 'pattern is longer than 128 characters' };
  if (!p.startsWith('^') || !/(^|[^\\])(\\\\)*\$$/.test(p) || p.length < 2) return { error: 'pattern must start with ^ and end with $' };
  const inner = p.slice(1, -1);
  const problem = patternProblem(inner);
  if (problem) return { error: `pattern rejected: ${problem}` };
  try { return { re: new RegExp(`^(?:${inner})$`, 'u') }; } catch { return { error: 'pattern is not a valid regular expression' }; }
}

type ParamCheck = { ok: true; value: string } | { ok: false; error: string };

/** Validate a user-supplied value against the declared type BEFORE it is substituted anywhere. */
export function checkParam(p: JobParam, raw: unknown): ParamCheck {
  const fail = (error: string): ParamCheck => ({ ok: false, error: `${p.name}: ${error}` });
  let s: string;
  switch (p.type) {
    case 'integer':
    case 'number': {
      let n: number;
      if (typeof raw === 'number') n = raw;
      else if (typeof raw === 'string' && (p.type === 'integer' ? /^-?\d{1,15}$/ : /^-?\d{1,15}(\.\d{1,15})?$/).test(raw)) n = Number(raw);
      else return fail(`must be ${p.type === 'integer' ? 'an integer' : 'a number'}`);
      if (!Number.isFinite(n) || (p.type === 'integer' && !Number.isSafeInteger(n))) return fail('must be a finite number');
      if (p.min !== undefined && n < p.min) return fail(`must be at least ${p.min}`);
      if (p.max !== undefined && n > p.max) return fail(`must be at most ${p.max}`);
      s = String(n);
      break;
    }
    case 'boolean':
      if (raw === true || raw === 'true') s = 'true';
      else if (raw === false || raw === 'false') s = 'false';
      else return fail('must be true or false');
      break;
    case 'secret':
      return fail('is not supported for this kind of job'); // workflow jobs handle secrets in dagu/params.ts; nothing else may
    default: {
      if (typeof raw !== 'string') return fail('must be a string');
      const max = Math.min(p.max_length ?? DEFAULT_MAX_LEN, p.pattern !== undefined ? MAX_PATTERN_INPUT : MAX_STRING_PARAM); // a pattern never sees more than 256 chars
      if (raw.length > max) return fail(`must be at most ${max} characters`); // length first: bounds regex work
      if (CTRL.test(raw)) return fail('must not contain control characters or newlines');
      if (raw.includes('secret://')) return fail('must not contain a secret reference');
      if (p.type === 'enum') { if (!(p.values ?? []).includes(raw)) return fail('is not one of the allowed values'); }
      else if (p.type === 's3_url') { if (!isS3Url(raw, true)) return fail('must be an s3://bucket/key URL'); }
      else if (p.type === 'http_url') { if (!isHttpsUrl(raw)) return fail('must be an https:// URL on a public host'); }
      else if (p.pattern !== undefined) {
        const c = compilePattern(p.pattern);
        if ('error' in c || !c.re.test(raw)) return fail('does not match the required format');
      }
      s = raw;
    }
  }
  return { ok: true, value: s };
}

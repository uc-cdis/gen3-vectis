/**
 * The one place that decides what "safe to show" means for text that came from outside: service responses, log lines,
 * node labels, definitions, user input. Do not write another control-character regex; import from here.
 *
 * Hidden characters (Unicode category C, plus U+2028/2029) are never deleted: they are shown as a visible `<U+XXXX>` token.
 *   stripInvisible, sanitizeUntrusted         at an API boundary: escape hidden characters and keep the rest (notes keep newlines).
 *   sanitizeText, sanitizeLabel, sanitizeLogText  server side, bounded: the same escape, then cap the length.
 *   safeText, cleanText, truncateText         for rendering: short single-line text (tab and newline become spaces).
 *   neutraliseBraces, escapeHtml              for the chart library (rich-text labels, HTML tooltips).
 *   hasControlChars, hasParserUnsafeChars     to REJECT input instead of cleaning it.
 */

// ONE rule for every helper below: a SIEM never alters evidence silently, so a hidden character is shown, not deleted.
// Every character of Unicode category C (Cc, Cf, Co, Cs, Cn: controls, bidi and zero-width, tag characters, soft hyphen,
// U+180E, private use, lone surrogates, unassigned) plus the line and paragraph separators U+2028/U+2029 (Zl, Zp) is replaced
// by a visible token such as <U+E0069>. Tab and newline are the only exceptions, and only where the helper keeps whitespace.
const HIDDEN = /[\p{C}\u2028\u2029]/gu;
const WS_TO_SPACE = /[\t\n]/g;
// A token the length cut may have split: "<U+", "<U+E00"
const PARTIAL_TOKEN = /<(?:U(?:\+[0-9A-F]{0,6})?)?$/;

/** The visible token for one code point: `<U+E0069>`, at least 4 upper-case hex digits. */
export const escapeCodePoint = (cp: number): string => `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`;

/**
 * Show every hidden character as `<U+XXXX>`. Works on code points, so lone surrogates and astral characters are handled
 * and nothing can throw. Tab and newline are kept. Non-strings give ''.
 */
export function escapeHidden(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(HIDDEN, (c) => (c === '\t' || c === '\n' ? c : escapeCodePoint(c.codePointAt(0) ?? 0xfffd)));
}

// C0 controls, DEL, C1 controls: refused in definitions.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
// Characters two parsers can read differently (line separators, soft hyphen, invisible formatting): refused in definitions.
// eslint-disable-next-line no-control-regex
const PARSER_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

const MAX_LOG_CHARS = 64 * 1024;

/** Show hidden characters (bidi, zero-width, tag characters, controls) as `<U+XXXX>`; keeps tab, newline and everything printable. */
export const stripInvisible = (s: string): string => escapeHidden(s);
export const hasControlChars = (v: string): boolean => typeof v === 'string' && CONTROL.test(v);
export const hasParserUnsafeChars = (v: string): boolean => typeof v === 'string' && PARSER_UNSAFE.test(v);

/**
 * Escape hidden characters in every string in a payload (values only; object keys are left alone). Iterative, so a response
 * nested 10,000 deep (or 10 million) cannot overflow the stack, and a cyclic or shared object is visited once.
 */
export function sanitizeUntrusted<T>(value: T): T {
  if (typeof value === 'string') return escapeHidden(value) as T;
  if (value === null || typeof value !== 'object') return value;
  const done = new Map<object, unknown>();
  const todo: { src: object; out: unknown[] | Record<string, unknown> }[] = [];
  const visit = (v: unknown): unknown => {
    if (typeof v === 'string') return escapeHidden(v);
    if (v === null || typeof v !== 'object') return v;
    const seen = done.get(v);
    if (seen !== undefined) return seen;
    const out: unknown[] | Record<string, unknown> = Array.isArray(v) ? new Array<unknown>(v.length) : {};
    done.set(v, out);
    todo.push({ src: v, out });
    return out;
  };
  const root = visit(value);
  while (todo.length) {
    const { src, out } = todo.pop() as (typeof todo)[number];
    try {
      if (Array.isArray(src)) {
        for (let i = 0; i < src.length; i++) (out as unknown[])[i] = visit(src[i]);
      } else {
        for (const k of Object.keys(src)) {
          // defineProperty: a key "__proto__" must stay an own data property, never set the prototype
          Object.defineProperty(out, k, { value: visit((src as Record<string, unknown>)[k]), enumerable: true, writable: true, configurable: true });
        }
      }
    } catch {
      // a getter or proxy that throws: say so instead of failing the whole response
      if (Array.isArray(out)) { out.length = 0; out.push('[unreadable]'); } else { for (const k of Object.keys(out)) delete out[k]; out['unreadable'] = '[unreadable]'; }
    }
  }
  return root as T;
}

/** Escape hidden characters and cap the length. Keeps tab and newline. Never throws; non-strings give ''. */
export function sanitizeLogText(input: unknown, max = MAX_LOG_CHARS): { text: string; truncated: boolean } {
  if (typeof input !== 'string') return { text: '', truncated: false };
  // cap first (cheap on huge input), then escape; escaping lengthens, so the length cut comes last
  let cap = input.length > max * 2 ? max * 2 : input.length;
  if (cap < input.length && cap > 0) {
    const c = input.charCodeAt(cap - 1);
    if (c >= 0xd800 && c <= 0xdbff) cap -= 1; // do not split a surrogate pair
  }
  let s = escapeHidden(cap < input.length ? input.slice(0, Math.max(0, cap)) : input);
  let truncated = input.length > max * 2 && s.length <= max;
  if (s.length > max) {
    let cut = Math.max(0, max);
    const c = s.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut -= 1; // do not split a surrogate pair
    s = s.slice(0, Math.max(0, cut)).replace(PARTIAL_TOKEN, ''); // do not leave half an escape token
    truncated = true;
  }
  return { text: s, truncated };
}

export const sanitizeText = (input: unknown, max = MAX_LOG_CHARS): string => sanitizeLogText(input, max).text;
/** Single-line label: also removes newlines and tabs. */
export const sanitizeLabel = (input: unknown, max = 256): string => sanitizeText(input, max).replace(/[\n\t]+/g, ' ').trim();

/** Cut to at most `max` characters (counting code points, never splitting a surrogate pair), adding an ellipsis. */
export function truncateText(text: string, max: number): string {
  if (typeof text !== 'string') return '';
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

/** Tab and newline become spaces, every other hidden character becomes a token. */
const oneLine = (v: unknown): string => escapeHidden(typeof v === 'string' ? v.replace(WS_TO_SPACE, ' ') : v);

/** Short single-line text of at most `max` characters: tab and newline become spaces, hidden characters are shown as `<U+XXXX>`, ends are trimmed. */
export const cleanText = (v: string, max: number): string => truncateText(oneLine(v).trim(), max);

/** Any unknown value as short, printable text. Objects are shown as JSON. */
export function safeText(value: unknown, max = 120): string {
  let s: string;
  try {
    if (value === null || value === undefined) s = '';
    else if (typeof value === 'string') s = value;
    else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') s = String(value);
    else s = JSON.stringify(value) ?? '';
  } catch { s = '[unreadable]'; }
  return truncateText(oneLine(s), max);
}

/**
 * ECharts treats `{style|text}` in a label as rich-text markup. Replace the ASCII braces with the visually
 * similar full-width ones so a hostile value cannot style or reshape the label.
 */
export const neutraliseBraces = (s: string): string => s.replace(/\{/g, '｛').replace(/\}/g, '｝');

/** Tooltips are the one place ECharts renders HTML. Escape everything that goes into one. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

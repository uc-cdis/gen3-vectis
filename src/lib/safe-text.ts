/**
 * The one place that decides what "safe to show" means for text that came from outside: service responses, log lines,
 * node labels, definitions, user input. Do not write another control-character regex; import from here.
 *
 *   stripInvisible, sanitizeUntrusted         at an API boundary: remove characters that change how text DISPLAYS (bidi
 *                                             overrides and isolates, zero-width) and keep the rest (notes keep newlines).
 *   sanitizeText, sanitizeLabel, sanitizeLogText  server side, bounded: also strip control characters and cap the length.
 *   safeText, cleanText, truncateText         for rendering: short, printable text.
 *   neutraliseBraces, escapeHtml              for the chart library (rich-text labels, HTML tooltips).
 *   hasControlChars, hasParserUnsafeChars     to REJECT input instead of cleaning it.
 */

// U+061C, U+200B-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069, U+FEFF
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
// Same set plus every C0/C1 control character: what rendering helpers replace with a space.
// eslint-disable-next-line no-control-regex
const UNSAFE_TO_SPACE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
// C0 controls except \t and \n, DEL and C1 controls (includes ESC, so terminal escape sequences lose their effect).
// eslint-disable-next-line no-control-regex
const CONTROL_KEEP_WHITESPACE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
// Characters two parsers can read differently (line separators, soft hyphen, invisible formatting): refused in definitions.
// eslint-disable-next-line no-control-regex
const PARSER_UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

const MAX_LOG_CHARS = 64 * 1024;

export const stripInvisible = (s: string): string => s.replace(INVISIBLE, '');
export const hasControlChars = (v: string): boolean => CONTROL.test(v);
export const hasParserUnsafeChars = (v: string): boolean => PARSER_UNSAFE.test(v);

/** Strip invisible characters from every string in a payload (values only; object keys are left alone). */
export function sanitizeUntrusted<T>(value: T): T {
  if (typeof value === 'string') return stripInvisible(value) as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeUntrusted(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeUntrusted(v);
    return out as T;
  }
  return value;
}

/** Strip control, bidi and zero-width characters and cap the length. Never throws; non-strings give ''. */
export function sanitizeLogText(input: unknown, max = MAX_LOG_CHARS): { text: string; truncated: boolean } {
  if (typeof input !== 'string') return { text: '', truncated: false };
  // cap first (cheap on huge input), then clean; cleaning only shortens
  let s = input.length > max * 2 ? input.slice(0, max * 2) : input;
  s = stripInvisible(s.replace(CONTROL_KEEP_WHITESPACE, ''));
  let truncated = input.length > max * 2 && s.length <= max;
  if (s.length > max) {
    let cut = max;
    const c = s.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut -= 1; // do not split a surrogate pair
    s = s.slice(0, cut);
    truncated = true;
  }
  return { text: s, truncated };
}

export const sanitizeText = (input: unknown, max = MAX_LOG_CHARS): string => sanitizeLogText(input, max).text;
/** Single-line label: also removes newlines and tabs. */
export const sanitizeLabel = (input: unknown, max = 256): string => sanitizeText(input, max).replace(/[\n\t]+/g, ' ').trim();

/** Cut to at most `max` characters (counting code points, never splitting a surrogate pair), adding an ellipsis. */
export function truncateText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

/** Printable text of at most `max` characters: unsafe characters become spaces, ends are trimmed. */
export const cleanText = (v: string, max: number): string => truncateText(v.replace(UNSAFE_TO_SPACE, ' ').trim(), max);

/** Any unknown value as short, printable text. Objects are shown as JSON. */
export function safeText(value: unknown, max = 120): string {
  let s: string;
  if (value === null || value === undefined) s = '';
  else if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') s = String(value);
  else {
    try { s = JSON.stringify(value) ?? ''; } catch { s = '[unreadable]'; }
  }
  return truncateText(s.replace(UNSAFE_TO_SPACE, ' '), max);
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

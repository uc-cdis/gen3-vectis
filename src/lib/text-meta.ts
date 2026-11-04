/**
 * Reads the `text_meta` / `textMeta` column of an event row: what the writer altered in the row's text fields.
 * Shape (from the ETL): `{field: {len, sha256, truncated?, redacted?, redacted_sha256?, hidden?}}`, where `len` and `sha256` describe the ORIGINAL value.
 * The value is untrusted: a malformed value is `unreadable`, never an exception, and every string that is shown goes through the safe-text helpers.
 */
import { safeText } from '@/lib/safe-text';

export interface TextMetaField {
  field: string;
  /** Original length in characters, or null when the entry did not carry a usable number. */
  length: number | null;
  /** The sha256 of the original value (64 hex digits), or null. */
  sha256: string | null;
  truncated: boolean;
  redacted: boolean;
  redactedSha256: string | null;
  /** How many hidden or control characters were shown as `<U+XXXX>`; 0 when none. */
  hidden: number;
}

export type TextMeta = { kind: 'none' } | { kind: 'unreadable' } | { kind: 'fields'; fields: TextMetaField[]; more: number };

/** Most fields listed; a real row has a handful. */
const MAX_FIELDS = 50;
const HEX64 = /^[0-9a-fA-F]{64}$/;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** `raw` is the column value: a JSON string, or already an object. Empty, null or absent is `none`. */
export function parseTextMeta(raw: unknown): TextMeta {
  if (raw === null || raw === undefined || raw === '') return { kind: 'none' };
  let doc: unknown = raw;
  if (typeof raw === 'string') {
    try { doc = JSON.parse(raw); } catch { return { kind: 'unreadable' }; }
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { kind: 'unreadable' };
  let entries: [string, unknown][];
  try { entries = Object.entries(doc as Record<string, unknown>); } catch { return { kind: 'unreadable' }; }
  if (entries.length === 0) return { kind: 'none' };
  const fields: TextMetaField[] = [];
  for (const [name, entry] of entries.slice(0, MAX_FIELDS)) {
    const e = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
    if (!e) return { kind: 'unreadable' };
    const sha = typeof e.sha256 === 'string' && HEX64.test(e.sha256) ? e.sha256.toLowerCase() : null;
    const rsha = typeof e.redacted_sha256 === 'string' && HEX64.test(e.redacted_sha256) ? e.redacted_sha256.toLowerCase() : null;
    fields.push({
      field: safeText(name, 64),
      length: num(e.len),
      sha256: sha,
      truncated: e.truncated === true,
      redacted: e.redacted === true,
      redactedSha256: rsha,
      hidden: num(e.hidden) ?? (e.hidden === true ? 1 : 0),
    });
  }
  return { kind: 'fields', fields, more: Math.max(0, entries.length - MAX_FIELDS) };
}

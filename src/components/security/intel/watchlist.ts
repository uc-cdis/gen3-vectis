import type { WatchlistEntry } from '@/lib/vectis-kit/spec';
import { IOC_TYPES, MAX_VALUE_LENGTH } from '@/lib/vectis-kit/spec/indicator';
import { hasControlChars } from '@/lib/safe-text';

export const MAX_WATCHLIST = 1000; // contract.py MAX_WATCHLIST
export const MAX_NOTE = 512;


interface RawWatchlistEntry {
  type: string;
  value: string;
  confidence: number | string;
  /** A date and time as the browser's datetime-local input gives it, or empty for no expiry. */
  expires?: string;
  note?: string;
}
type EntryResult = { ok: true; entry: WatchlistEntry } | { ok: false; error: string };

/** Validate one entry against the contract (WatchlistEntry): type, value 1..512, confidence 0..100, future expiry, note <= 512. */
export function validateWatchlistEntry(raw: RawWatchlistEntry, now: number = Date.now()): EntryResult {
  if (!(IOC_TYPES as readonly string[]).includes(raw.type)) return { ok: false, error: `Unsupported type "${String(raw.type).slice(0, 40)}". Use ip, domain, url, hash or email.` };
  const value = raw.value.trim();
  if (value === '') return { ok: false, error: 'The value is empty.' };
  if (value.length > MAX_VALUE_LENGTH) return { ok: false, error: `The value is ${value.length} characters; the maximum is ${MAX_VALUE_LENGTH}.` };
  if (hasControlChars(value)) return { ok: false, error: 'The value contains control characters.' };

  const c = typeof raw.confidence === 'string' ? (raw.confidence.trim() === '' ? Number.NaN : Number(raw.confidence)) : raw.confidence;
  if (!Number.isInteger(c) || c < 0 || c > 100) return { ok: false, error: 'Confidence must be a whole number from 0 to 100.' };

  let expires_at: string | null = null;
  if (raw.expires && raw.expires.trim() !== '') {
    const t = new Date(raw.expires).getTime();
    if (Number.isNaN(t)) return { ok: false, error: 'The expiry is not a valid date and time.' };
    if (t <= now) return { ok: false, error: 'The expiry must be in the future.' };
    expires_at = new Date(t).toISOString();
  }
  const note = (raw.note ?? '').trim();
  if (note.length > MAX_NOTE) return { ok: false, error: `The note is ${note.length} characters; the maximum is ${MAX_NOTE}.` };

  return { ok: true, entry: { type: raw.type as WatchlistEntry['type'], value, confidence: c, expires_at, note } };
}

interface LineError { line: number; value: string; error: string }
interface ParsedWatchlist { entries: WatchlistEntry[]; errors: LineError[]; duplicates: number; tooMany: boolean }

/**
 * Parse pasted text, one value per line (blank lines ignored, duplicates collapsed), applying the same type,
 * confidence, expiry and note to all. More than 1000 entries is rejected as a whole: nothing is sent.
 */
export function parseWatchlistLines(text: string, common: Omit<RawWatchlistEntry, 'value'>, now: number = Date.now()): ParsedWatchlist {
  const entries: WatchlistEntry[] = [];
  const errors: LineError[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 20 * MAX_WATCHLIST) return { entries, errors, duplicates, tooMany: true };
  // The type, confidence, expiry and note are shared, so a mistake there is reported once, not once per line.
  const shared = validateWatchlistEntry({ ...common, value: 'x' }, now);
  if (!shared.ok) return { entries, errors: [{ line: 0, value: '', error: shared.error }], duplicates, tooMany: false };
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    const r = validateWatchlistEntry({ ...common, value: line }, now);
    if (!r.ok) { errors.push({ line: i + 1, value: line.trim().slice(0, 80), error: r.error }); return; }
    const k = `${r.entry.type}:${r.entry.value}`;
    if (seen.has(k)) { duplicates += 1; return; }
    seen.add(k);
    entries.push(r.entry);
  });
  return { entries, errors, duplicates, tooMany: entries.length > MAX_WATCHLIST };
}

import { describe, expect, it } from 'vitest';
import { MAX_WATCHLIST, parseWatchlistLines, validateWatchlistEntry } from './watchlist';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const ok = { type: 'ip', value: '192.0.2.1', confidence: 75 };

describe('validateWatchlistEntry', () => {
  it('accepts a valid entry and converts the expiry to UTC ISO', () => {
    const r = validateWatchlistEntry({ ...ok, expires: '2027-01-01T00:00:00Z', note: ' hi ' }, NOW);
    expect(r).toEqual({ ok: true, entry: { type: 'ip', value: '192.0.2.1', confidence: 75, expires_at: '2027-01-01T00:00:00.000Z', note: 'hi' } });
  });
  it.each([
    ['bad type', { ...ok, type: 'file' }, /Unsupported type/],
    ['empty value', { ...ok, value: '   ' }, /empty/],
    ['513 characters', { ...ok, value: 'a'.repeat(513) }, /513 characters/],
    ['control characters', { ...ok, value: 'a\u0007b' }, /control/],
    ['confidence 101', { ...ok, confidence: 101 }, /0 to 100/],
    ['confidence -1', { ...ok, confidence: -1 }, /0 to 100/],
    ['confidence 5.5', { ...ok, confidence: 5.5 }, /whole number/],
    ['confidence empty', { ...ok, confidence: '' }, /whole number/],
    ['past expiry', { ...ok, expires: '2026-10-01T00:00:00Z' }, /future/],
    ['invalid expiry', { ...ok, expires: 'tomorrow-ish' }, /valid date/],
    ['note too long', { ...ok, note: 'n'.repeat(513) }, /note is 513/],
  ])('rejects %s', (_n, raw, msg) => {
    const r = validateWatchlistEntry(raw, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(msg);
  });
  it('accepts the boundaries: 512 characters, confidence 0 and 100', () => {
    expect(validateWatchlistEntry({ ...ok, value: 'a'.repeat(512), confidence: 0 }, NOW).ok).toBe(true);
    expect(validateWatchlistEntry({ ...ok, confidence: '100' }, NOW).ok).toBe(true);
  });
});

describe('parseWatchlistLines', () => {
  const common = { type: 'ip', confidence: 50, expires: '', note: '' };
  it('parses one per line, skipping blanks and collapsing duplicates', () => {
    const p = parseWatchlistLines('192.0.2.1\n\n192.0.2.2\r\n192.0.2.1\n', common, NOW);
    expect(p.entries.map((e) => e.value)).toEqual(['192.0.2.1', '192.0.2.2']);
    expect(p.duplicates).toBe(1);
    expect(p.errors).toEqual([]);
  });
  it('reports the line number of a bad value', () => {
    const p = parseWatchlistLines(`192.0.2.1\n${'a'.repeat(513)}`, common, NOW);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toMatchObject({ line: 2 });
  });
  it('flags 1001 entries as too many', () => {
    const text = Array.from({ length: MAX_WATCHLIST + 1 }, (_, i) => `host${i}.example.com`).join('\n');
    expect(parseWatchlistLines(text, { ...common, type: 'domain' }, NOW).tooMany).toBe(true);
  });
  it('allows exactly 1000 entries', () => {
    const text = Array.from({ length: MAX_WATCHLIST }, (_, i) => `host${i}.example.com`).join('\n');
    const p = parseWatchlistLines(text, { ...common, type: 'domain' }, NOW);
    expect(p.tooMany).toBe(false);
    expect(p.entries).toHaveLength(MAX_WATCHLIST);
  });
  it('reports a shared mistake once, not once per line', () => {
    const p = parseWatchlistLines('a\nb\nc', { ...common, confidence: 101 }, NOW);
    expect(p.errors).toHaveLength(1);
    expect(p.entries).toEqual([]);
  });
  it('reports a past expiry once', () => {
    expect(parseWatchlistLines('192.0.2.1', { ...common, expires: '2020-01-01T00:00:00Z' }, NOW).errors[0]!.error).toMatch(/future/);
  });
});

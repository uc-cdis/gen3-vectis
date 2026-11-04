import { describe, expect, it } from 'vitest';
import {
  cleanText, escapeHidden, hasControlChars, hasParserUnsafeChars, safeText, sanitizeLabel, sanitizeLogText, sanitizeText, sanitizeUntrusted, stripInvisible, truncateText,
} from '@/lib/safe-text';

// Built from code points so this file shows what it holds (no hidden character is typed into it).
const U = (...cps: number[]): string => String.fromCodePoint(...cps);
const tok = (cp: number): string => `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
const TAGS = U(0xe0049, 0xe0067, 0xe006e, 0xe006f, 0xe0072, 0xe0065); // a tag-character "Ignore"
/** Any character of Unicode category C, or a line or paragraph separator. */
const HIDDEN_RE = /[\p{C}\u2028\u2029]/u;

/** Hostile text, every kind at once. */
const CORPUS: Record<string, string> = {
  tagCharacters: `ok${TAGS}`,
  bidiOverride: `inv${U(0x202e)}oice${U(0x202c)}.exe`,
  bidiIsolates: `x${U(0x2066, 0x2067, 0x2068, 0x2069, 0x061c, 0x200e, 0x200f)}y`,
  zeroWidth: `a${U(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff)}b`,
  softHyphenAndMongolian: `a${U(0x00ad, 0x180e)}b`,
  lineSeparators: `a${U(0x2028, 0x2029)}b`,
  controls: `a${U(0x0000, 0x0007, 0x001b, 0x007f, 0x0085, 0x009f)}b`,
  privateUseAndUnassigned: `a${U(0xe000, 0xf8ff, 0xffff, 0x10ffff, 0xf0000)}b`,
  loneHighSurrogate: `a${String.fromCharCode(0xd83d)}b`,
  loneLowSurrogate: `a${String.fromCharCode(0xde00)}b`,
  endsInHighSurrogate: `abc${String.fromCharCode(0xd83d)}`,
  megabyte: 'x'.repeat(1024 * 1024),
  megabyteOfTags: U(0xe0041).repeat(256 * 1024),
  badPercent: '%E0%A4%A',
  protoKey: '__proto__',
  constructorKey: 'constructor',
  emptyString: '',
};

describe('one rule: every hidden character is shown as <U+XXXX>, never deleted and never passed through', () => {
  it('stripInvisible, sanitizeText, sanitizeLabel, cleanText and safeText show tag characters', () => {
    const shown = `ok${tok(0xe0049)}${tok(0xe0067)}${tok(0xe006e)}${tok(0xe006f)}${tok(0xe0072)}${tok(0xe0065)}`;
    expect(stripInvisible(`ok${TAGS}`)).toBe(shown);
    expect(sanitizeText(`ok${TAGS}`)).toBe(shown);
    expect(sanitizeLabel(`ok${TAGS}`)).toBe(shown);
    expect(cleanText(`ok${TAGS}`, 200)).toBe(shown);
    expect(safeText(`ok${TAGS}`, 200)).toBe(shown);
    expect(sanitizeUntrusted(`ok${TAGS}`)).toBe(shown);
  });
  it('uses upper-case hex of at least four digits', () => {
    expect(escapeHidden(U(0x00ad))).toBe('<U+00AD>');
    expect(escapeHidden(U(0x180e))).toBe('<U+180E>');
    expect(escapeHidden(U(0x0000))).toBe('<U+0000>');
    expect(escapeHidden(U(0x10ffff))).toBe('<U+10FFFF>');
    expect(escapeHidden(U(0xe0069))).toBe('<U+E0069>');
  });
  it('covers soft hyphen, U+180E, U+2028/2029, bidi, zero-width, controls, private use and unassigned', () => {
    for (const cp of [0x00ad, 0x180e, 0x2028, 0x2029, 0x202e, 0x2066, 0x061c, 0x200b, 0x200d, 0xfeff, 0x2060, 0x0001, 0x001b, 0x007f, 0x0085, 0x009f, 0xe000, 0xffff, 0xe0001, 0xe007f, 0xf0000]) {
      const s = `a${U(cp)}b`;
      for (const out of [stripInvisible(s), sanitizeText(s), sanitizeLabel(s), cleanText(s, 50), safeText(s, 50), sanitizeUntrusted(s)]) {
        expect(out).toBe(`a${tok(cp)}b`);
      }
    }
  });
  it('shows a lone surrogate as a token (by code point, no crash) and keeps a real pair', () => {
    expect(escapeHidden(`a${String.fromCharCode(0xd83d)}b`)).toBe('a<U+D83D>b');
    expect(escapeHidden(`a${String.fromCharCode(0xde00)}b`)).toBe('a<U+DE00>b');
    expect(escapeHidden(`a${U(0x1f600)}b`)).toBe(`a${U(0x1f600)}b`);
  });
  it('keeps tab and newline where the helper keeps whitespace, and everything printable', () => {
    const s = 'line one\nline two\t日本語 Ελληνικά café 😀';
    expect(stripInvisible(s)).toBe(s);
    expect(sanitizeText(s)).toBe(s);
    expect(sanitizeUntrusted(s)).toBe(s);
    expect(sanitizeLabel(s)).toBe('line one line two 日本語 Ελληνικά café 😀');
    expect(cleanText(s, 200)).toBe('line one line two 日本語 Ελληνικά café 😀');
    expect(safeText(s, 200)).toBe('line one line two 日本語 Ελληνικά café 😀');
  });
  it('shows CR and the other C0 controls (only tab and newline are exempt)', () => {
    expect(sanitizeText('a\r\nb')).toBe('a<U+000D>\nb');
  });
  it('nothing in category C survives raw through any helper, and nothing throws, on the hostile corpus', () => {
    const helpers: Record<string, (s: string) => unknown> = {
      stripInvisible, escapeHidden: (s) => escapeHidden(s), sanitizeText: (s) => sanitizeText(s), sanitizeLabel: (s) => sanitizeLabel(s),
      sanitizeLogText: (s) => sanitizeLogText(s).text, cleanText: (s) => cleanText(s, 120), safeText: (s) => safeText(s, 120),
      sanitizeUntrusted: (s) => sanitizeUntrusted({ s, a: [s], n: { s } }), truncateText: (s) => truncateText(s, 50),
      hasControlChars, hasParserUnsafeChars,
    };
    for (const [hname, h] of Object.entries(helpers)) {
      for (const [cname, input] of Object.entries(CORPUS)) {
        let out: unknown;
        expect(() => { out = h(input); }, `${hname}(${cname}) threw`).not.toThrow();
        if (hname === 'truncateText' || hname.startsWith('has')) continue; // not escape helpers
        if (typeof out === 'object') out = JSON.stringify(out);
        const text = String(out);
        // JSON.stringify of the nested form re-escapes tab/newline only; hidden characters would show up raw
        expect(HIDDEN_RE.test(text.replace(/[\t\n]/g, '')), `${hname}(${cname}) leaked a hidden character`).toBe(false);
      }
    }
    expect(sanitizeText(CORPUS.tagCharacters!)).toContain('<U+E0049>');
    expect(sanitizeText(CORPUS.bidiOverride!)).toContain('<U+202E>');
    expect(sanitizeText(CORPUS.zeroWidth!)).toContain('<U+200B>');
  });
  it('shows the escape token for the hostile corpus entries', () => {
    expect(sanitizeLabel(CORPUS.loneHighSurrogate)).toBe('a<U+D83D>b');
    expect(sanitizeLabel(CORPUS.softHyphenAndMongolian)).toBe('a<U+00AD><U+180E>b');
    expect(sanitizeLabel(CORPUS.lineSeparators)).toBe('a<U+2028><U+2029>b');
    expect(sanitizeLabel(CORPUS.badPercent)).toBe('%E0%A4%A');
    expect(sanitizeLabel(CORPUS.protoKey)).toBe('__proto__');
  });
  it('a 1 MB string stays bounded and fast', () => {
    const t0 = Date.now();
    expect(sanitizeText(CORPUS.megabyte).length).toBe(64 * 1024);
    expect(sanitizeLogText(CORPUS.megabyte).truncated).toBe(true);
    expect(sanitizeLabel(CORPUS.megabyteOfTags).length).toBeLessThanOrEqual(256);
    expect(cleanText(CORPUS.megabyteOfTags, 100).length).toBeLessThanOrEqual(100 * 2);
    expect(safeText(CORPUS.megabyteOfTags, 100).length).toBeLessThanOrEqual(100 * 2);
    expect(stripInvisible(CORPUS.megabyteOfTags).length).toBe(256 * 1024 * '<U+E0041>'.length);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('never throws on any input type', () => {
    const cyc: Record<string, unknown> = { a: 1 }; cyc.self = cyc;
    const nasty: unknown[] = [undefined, null, 0, NaN, BigInt(12), Symbol('x'), () => 1, {}, [], cyc, new Date(NaN), Object.create(null), { toJSON() { throw new Error('boom'); } }, { v: BigInt(12) }];
    for (const v of nasty) {
      expect(() => safeText(v)).not.toThrow();
      expect(() => sanitizeText(v)).not.toThrow();
      expect(() => sanitizeLabel(v)).not.toThrow();
      expect(() => sanitizeLogText(v)).not.toThrow();
      expect(() => sanitizeUntrusted(v)).not.toThrow();
      expect(() => stripInvisible(v as string)).not.toThrow();
      expect(() => cleanText(v as string, 10)).not.toThrow();
      expect(() => truncateText(v as string, 10)).not.toThrow();
      expect(() => hasControlChars(v as string)).not.toThrow();
      expect(() => hasParserUnsafeChars(v as string)).not.toThrow();
    }
    expect(safeText({ toJSON() { throw new Error('boom'); } })).toBe('[unreadable]');
  });
});

describe('truncation is unchanged and does not split a character or an escape token', () => {
  it('sanitizeLogText caps the length and reports truncation', () => {
    const r = sanitizeLogText('x'.repeat(100), 10);
    expect(r.text).toBe('x'.repeat(10));
    expect(r.truncated).toBe(true);
    expect(sanitizeLogText('abc', 10).truncated).toBe(false);
    expect(sanitizeText(42)).toBe('');
  });
  it('does not split a surrogate pair', () => {
    expect(sanitizeText('a😀', 2)).toBe('a');
    expect(sanitizeText('x'.repeat(9) + '😀'.repeat(10), 10)).toBe('x'.repeat(9));
  });
  it('does not leave half an escape token at the cut', () => {
    const s = `ab${U(0xe0069)}`; // 'ab<U+E0069>'
    for (let max = 1; max < s.length + 2; max += 1) {
      const out = sanitizeText(s, max);
      expect(out === 'ab<U+E0069>'.slice(0, out.length) && !/<[^>]*$/.test(out)).toBe(true);
    }
    expect(sanitizeText(s, 5)).toBe('ab');
    expect(sanitizeText(s, 11)).toBe('ab<U+E0069>');
  });
  it('truncateText and the printable helpers keep counting code points', () => {
    expect(truncateText('abcdef', 4)).toBe('abc…');
    expect(Array.from(truncateText('😀'.repeat(10), 5))).toHaveLength(5);
    expect(cleanText('😀'.repeat(50), 10)).toBe(`${'😀'.repeat(9)}…`);
    expect(safeText({ a: 1 })).toBe('{"a":1}');
    expect(safeText(null)).toBe('');
  });
});

describe('sanitizeUntrusted', () => {
  it('shows bidi overrides, isolates and zero-width characters instead of removing them', () => {
    expect(stripInvisible(`inv${U(0x202e)}oice${U(0x202c)}.exe`)).toBe('inv<U+202E>oice<U+202C>.exe');
    expect(stripInvisible(`a${U(0x200b, 0x200c, 0x200d, 0xfeff, 0x2060)}f`)).toBe('a<U+200B><U+200C><U+200D><U+FEFF><U+2060>f');
    expect(stripInvisible(`x${U(0x2066)}y${U(0x2069)}z${U(0x061c)}`)).toBe('x<U+2066>y<U+2069>z<U+061C>');
  });
  it('cleans strings anywhere in a payload and leaves numbers, nulls and keys alone', () => {
    const key = `k${U(0x202e)}ey`;
    const out = sanitizeUntrusted({ a: [`x${U(0x202e)}y`, { b: `c${U(0x200b)}d`, n: 3, z: null }], [key]: 1 });
    expect(out).toEqual({ a: ['x<U+202E>y', { b: 'c<U+200B>d', n: 3, z: null }], [key]: 1 });
  });
  it('does not mutate its input', () => {
    const input = { t: `a${U(0x202e)}b`, l: [`${U(0x200b)}`] };
    sanitizeUntrusted(input);
    expect(input.t).toBe(`a${U(0x202e)}b`);
    expect(input.l[0]).toBe(U(0x200b));
  });
  it('keeps a "__proto__" key as plain data and never changes a prototype', () => {
    const parsed = JSON.parse('{"__proto__": {"polluted": "yes"}, "a": {"__proto__": "x"}}') as unknown;
    const out = sanitizeUntrusted(parsed) as Record<string, unknown>;
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.getOwnPropertyDescriptor(out, '__proto__')?.value as Record<string, unknown>).polluted).toBe('yes');
  });
  it('survives a response nested 10,000 and 1,000,000 deep (no RangeError)', () => {
    for (const depth of [10_000, 1_000_000]) {
      let deepArray: unknown = `leaf${U(0x202e)}`;
      for (let i = 0; i < depth; i += 1) deepArray = [deepArray];
      let deepObject: unknown = `leaf${U(0x202e)}`;
      for (let i = 0; i < depth; i += 1) deepObject = { k: deepObject };
      for (const deep of [deepArray, deepObject]) {
        let out: unknown;
        expect(() => { out = sanitizeUntrusted(deep); }).not.toThrow();
        let cur: unknown = out;
        for (let i = 0; i < depth; i += 1) cur = Array.isArray(cur) ? cur[0] : (cur as { k: unknown }).k;
        expect(cur).toBe('leaf<U+202E>');
      }
    }
  });
  it('survives a nested payload that JSON.parse built (the real path)', () => {
    const text = '['.repeat(10_000) + '"x"' + ']'.repeat(10_000);
    expect(() => sanitizeUntrusted(JSON.parse(text))).not.toThrow();
  });
  it('handles a cyclic or shared object without looping', () => {
    const a: Record<string, unknown> = { s: `x${U(0x200b)}` };
    a.self = a;
    const shared = { s: U(0x200b) };
    const out = sanitizeUntrusted({ a, p: shared, q: shared }) as { a: { s: string; self: unknown }; p: { s: string }; q: { s: string } };
    expect(out.a.s).toBe('x<U+200B>');
    expect(out.a.self).toBe(out.a);
    expect(out.p.s).toBe('<U+200B>');
    expect(out.q).toBe(out.p);
  });
  it('degrades an object whose getter throws to a marker', () => {
    const bad = { get boom(): string { throw new Error('boom'); }, ok: 'fine' };
    const out = sanitizeUntrusted({ bad }) as { bad: Record<string, unknown> };
    expect(out.bad.unreadable).toBe('[unreadable]');
  });
});

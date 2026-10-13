import { describe, expect, it } from 'vitest';
import { sanitizeUntrusted, stripInvisible } from '@/lib/safe-text';

describe('sanitizeUntrusted', () => {
  it('removes bidi overrides, isolates and zero-width characters', () => {
    expect(stripInvisible('inv‮oice‬.exe')).toBe('invoice.exe');
    expect(stripInvisible('a​b‌c‍d﻿e⁠f')).toBe('abcdef');
    expect(stripInvisible('x⁦y⁩z؜')).toBe('xyz');
  });
  it('keeps ordinary text, newlines, tabs and non-Latin scripts', () => {
    const s = 'line one\nline two\t日本語 Ελληνικά';
    expect(stripInvisible(s)).toBe(s);
  });
  it('cleans strings anywhere in a payload and leaves numbers, nulls and keys alone', () => {
    const out = sanitizeUntrusted({ a: ['x‮y', { b: 'c​d', n: 3, z: null }], 'k‮ey': 1 });
    expect(out).toEqual({ a: ['xy', { b: 'cd', n: 3, z: null }], 'k‮ey': 1 });
  });
  it('does not mutate its input', () => {
    const input = { t: 'a‮b' };
    sanitizeUntrusted(input);
    expect(input.t).toBe('a‮b');
  });
});

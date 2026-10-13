import { describe, expect, it } from 'vitest';
import { isTypingTarget, validateAssignee, validateConfidence, validateIndicator, validateReason } from './validate';

describe('validate', () => {
  it('requires a non-blank reason within the limit', () => {
    expect(validateReason('')).not.toBeNull();
    expect(validateReason('  \n ')).not.toBeNull();
    expect(validateReason('x'.repeat(513))).not.toBeNull();
    expect(validateReason('known scanner')).toBeNull();
  });
  it('rejects control characters and over-long names in assignee', () => {
    expect(validateAssignee('a\u0000b')).not.toBeNull();
    expect(validateAssignee('x'.repeat(257))).not.toBeNull();
    expect(validateAssignee(' analyst1 ')).toBeNull();
  });
  it.each([
    ['ip', '203.0.113.5', true], ['ip', '999.1.1.1', false], ['ip', '2001:db8::1', true], ['ip', 'not an ip', false],
    ['domain', 'example.com', true], ['domain', 'exa mple.com', false], ['domain', 'localhost', false],
    ['url', 'https://example.com/a?b=1', true], ['url', 'javascript:alert(1)', false], ['url', 'ftp://x.test/', false],
    ['hash', 'd41d8cd98f00b204e9800998ecf8427e', true], ['hash', 'xyz', false],
    ['email', 'a@example.com', true], ['email', 'a@@example.com', false],
  ] as const)('indicator %s %s -> %s', (t, v, ok) => { expect(validateIndicator(t, v) === null).toBe(ok); });
  it('bounds confidence to 0..100', () => {
    for (const ok of ['0', '75', '100']) expect(validateConfidence(ok)).toBeNull();
    for (const bad of ['', '-1', '101', '1.5', 'abc', '1e2']) expect(validateConfidence(bad)).not.toBeNull();
  });
  it('recognises typing targets', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    const combo = document.createElement('div'); combo.setAttribute('role', 'combobox');
    expect(isTypingTarget(combo)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

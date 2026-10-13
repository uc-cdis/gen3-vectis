import { describe, expect, it } from 'vitest';
import { classifyIndicator, guessEntityType, isIpAddress, matchesIocType } from './indicator';

describe('isIpAddress', () => {
  it.each(['192.0.2.44', '0.0.0.0', '255.255.255.255', '2001:db8::1', '::1', '::', 'fe80::1:2', '::ffff:192.0.2.1', '2001:db8:0:0:0:0:0:1'])('accepts %s', (v) => expect(isIpAddress(v)).toBe(true));
  it.each([
    '999.1.1.1', '1.2.3', '1.2.3.4.5', '203.0.xxx.xxx', 'example.com', '', '1:2', ':::', '2001:db8:::1', '12345::1', 'g::1', '2001:db8::1%eth0',
    '1:2:3:4:5:6:7:8:9', `${'a:'.repeat(30)}1`, '[::1]', 'http://[::1]/',
  ])('rejects %s', (v) => expect(isIpAddress(v)).toBe(false));
});

describe('classifyIndicator', () => {
  it.each([
    ['192.0.2.44', 'ip'], ['2001:db8::1', 'ip'], ['example.com', 'domain'], ['https://e.example/x', 'url'],
    ['a@example.com', 'email'], ['d41d8cd98f00b204e9800998ecf8427e', 'hash'], ['  192.0.2.44  ', 'ip'],
  ])('%s is %s', (v, t) => expect(classifyIndicator(v)).toBe(t));
  it.each(['hello world', '', 'javascript:alert(1)', 'a\u0000b.example', 'x'.repeat(513)])('does not guess %j', (v) => expect(classifyIndicator(v)).toBeNull());
});

describe('guessEntityType', () => {
  it('names the type when it is recognisable and falls back to domain for display', () => {
    expect(guessEntityType('192.0.2.44')).toBe('ip');
    expect(guessEntityType('https://x.test/')).toBe('url');
    expect(guessEntityType('evil.example')).toBe('domain');
    expect(guessEntityType('not recognisable')).toBe('domain');
  });
});

describe('matchesIocType', () => {
  it('accepts hashes of 32 to 128 hex characters only', () => {
    expect(matchesIocType('hash', 'a'.repeat(32))).toBe(true);
    expect(matchesIocType('hash', 'a'.repeat(128))).toBe(true);
    expect(matchesIocType('hash', 'a'.repeat(31))).toBe(false);
    expect(matchesIocType('hash', 'a'.repeat(129))).toBe(false);
  });
  it('accepts only http and https URLs', () => {
    expect(matchesIocType('url', 'ftp://x.test/')).toBe(false);
    expect(matchesIocType('url', 'javascript:alert(1)')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { entityTypeOfGraphKind, seedFromGraphNode, validNodeId, validateEntityInput } from './entityKeys';

describe('validNodeId', () => {
  it('passes a legal node id through unchanged', () => {
    expect(validNodeId('tenant1:IpAddress:203.0.113.50')).toBe('tenant1:IpAddress:203.0.113.50');
    expect(validNodeId('tenant1:IpAddress:2001:db8::1')).toBe('tenant1:IpAddress:2001:db8::1');
  });
  it('is null when the profile has no graph id', () => {
    expect(validNodeId(null)).toBeNull();
    expect(validNodeId(undefined)).toBeNull();
    expect(validNodeId('')).toBeNull();
  });
  it('rejects ids that are not legal NodeIds', () => {
    expect(validNodeId('tenant1:Url:http://x/a b')).toBeNull();
    expect(validNodeId('a\nb')).toBeNull();
    expect(validNodeId('x'.repeat(257))).toBeNull();
  });
});

describe('seedFromGraphNode', () => {
  it('maps an entity node back to a seed', () => {
    expect(seedFromGraphNode({ id: 'tenant1:IpAddress:198.51.100.10', label: 'IpAddress' })).toEqual({ type: 'ip', value: '198.51.100.10' });
  });
  it('returns null for nodes that are not entities or whose id disagrees with the label', () => {
    expect(seedFromGraphNode({ id: 'tenant1:RequestSignature:/ntseq', label: 'RequestSignature' })).toBeNull();
    expect(seedFromGraphNode({ id: 'tenant1:Asn:AS1', label: 'IpAddress' })).toBeNull();
  });
  it.each([
    ['Domain', 'example.test', 'domain'],
    ['Hash', 'd41d8cd98f00b204e9800998ecf8427e', 'hash'],
    ['Host', 'web-1.example.test', 'host'],
    ['Principal', 'alice', 'user'],
    ['Principal', 'arn:aws:iam::111122223333:role/x', 'arn'],
  ])('opens a real %s node as an entity (%s)', (label, value, type) => {
    expect(seedFromGraphNode({ id: `tenant1:${label}:${value}`, label })).toEqual({ type, value });
  });
  it.each(['JA4Fingerprint', 'RequestSignature', 'LogSource', 'Country', 'Asn', 'Finding', 'UserAgent', 'Account', 'Indicator', 'Technique',
    'FileHash', 'UriPath', 'Url', 'EmailAddress', 'User', 'Arn', 'constructor'])('does not open a %s node as an entity', (label) => {
    expect(seedFromGraphNode({ id: `tenant1:${label}:x`, label })).toBeNull();
  });
  it('never opens a masked identity as an entity', () => {
    expect(seedFromGraphNode({ id: 'Principal:masked-0123456789abcdef', label: 'Principal' })).toBeNull();
  });
});

describe('entityTypeOfGraphKind', () => {
  it('maps only the kinds the portal has as entities', () => {
    expect(entityTypeOfGraphKind('IpAddress', '203.0.113.50')).toBe('ip');
    expect(entityTypeOfGraphKind('Host', 'h')).toBe('host');
    expect(entityTypeOfGraphKind('Principal', 'arn:aws:iam::111122223333:user/u')).toBe('arn');
    expect(entityTypeOfGraphKind('Principal', 'u')).toBe('user');
    expect(entityTypeOfGraphKind('Endpoint', 'h')).toBeNull();
    expect(entityTypeOfGraphKind('toString', 'x')).toBeNull();
  });
});

describe('validateEntityInput', () => {
  it('accepts a trimmed address', () => {
    expect(validateEntityInput('ip', '  203.0.113.50 ')).toEqual({ seed: { type: 'ip', value: '203.0.113.50' } });
  });
  it.each([
    ['ip', '', /Enter a value/],
    ['ip', 'not-an-ip', /valid IPv4 or IPv6/],
    ['ip', '999.1.1.1', /valid IPv4 or IPv6/],
    ['domain', 'x'.repeat(513), /Too long/],
    ['domain', 'a\u0000b', /control/],
    ['bogus', 'x', /Choose a type/],
  ])('rejects %s %j', (type, value, msg) => {
    const r = validateEntityInput(type, value);
    expect('error' in r && r.error).toMatch(msg);
  });
});

describe('entity search accepts URI paths and STIX patterns', () => {
  it('looks up a URI path', () => {
    expect(validateEntityInput('path', '/.env')).toEqual({ seed: { type: 'path', value: '/.env' } });
    expect(validateEntityInput('path', '.env')).toHaveProperty('error');
    expect(validateEntityInput('path', '/a?b=1')).toHaveProperty('error');
  });
  it('turns a STIX pattern into the entity it names, and checks that entity as if it had been typed', () => {
    expect(validateEntityInput('stix', "[domain-name:value = 'evil.example.com']")).toEqual({ seed: { type: 'domain', value: 'evil.example.com' } });
    expect(validateEntityInput('stix', "[ipv4-addr:value = '8.8.4.4']")).toEqual({ seed: { type: 'ip', value: '8.8.4.4' } });
    expect(validateEntityInput('stix', "[ipv4-addr:value = '999.1.1.1']")).toHaveProperty('error');
    expect(validateEntityInput('stix', "[process:name = 'x']")).toHaveProperty('error');
  });
});

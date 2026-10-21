import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { daguTarget } from './config';

const base = { NODE_ENV: 'production', DAGU_TOKEN: 'k'.repeat(24), DAGU_ALLOW_CLUSTER_HTTP: 'yes' } as Record<string, string | undefined>;
const target = (url: string, extra: Record<string, string | undefined> = {}) => daguTarget({ ...base, DAGU_URL: url, ...extra });

describe('Dagu URL rules in production', () => {
  it('allows a Kubernetes service name over http only with the explicit flag', () => {
    expect(target('http://dagu.gen3.svc.cluster.local:8080')).not.toBeNull();
    expect(target('http://dagu.gen3.svc:8080')).not.toBeNull();
    expect(target('http://dagu.gen3.svc.cluster.local:8080', { DAGU_ALLOW_CLUSTER_HTTP: undefined })).toBeNull();
  });
  it('allows a private name only when it is listed EXACTLY in DAGU_HTTP_HOSTS (docker/compose names)', () => {
    expect(target('http://dagu:8080')).toBeNull();
    expect(target('http://dagu:8080', { DAGU_HTTP_HOSTS: 'dagu' })).not.toBeNull();
    expect(target('http://dagu.svc.local:8080', { DAGU_HTTP_HOSTS: 'dagu, dagu.svc.local' })).not.toBeNull();
    expect(target('http://other:8080', { DAGU_HTTP_HOSTS: 'dagu' })).toBeNull();
    expect(target('http://dagu.evil.example:8080', { DAGU_HTTP_HOSTS: 'dagu' })).toBeNull();
    expect(target('http://dagu:8080', { DAGU_HTTP_HOSTS: 'dagu', DAGU_ALLOW_CLUSTER_HTTP: undefined })).toBeNull();
  });
  it('never accepts an IP address or a wildcard, even if listed', () => {
    for (const h of ['169.254.169.254', '10.0.0.5', '127.0.0.1', '[::1]', '*', '*.svc.local', '']) {
      expect(target(`http://${h || 'x'}:8080`, { DAGU_HTTP_HOSTS: h })).toBeNull();
    }
  });
  it('https is always fine and credentials in the url are refused', () => {
    expect(target('https://dagu.example.org')).not.toBeNull();
    expect(target('https://user:pw@dagu.example.org')).toBeNull();
  });
});

describe('service-account mode (DAGU_AUTH=serviceaccount): the pod presents its own identity, no Dagu credential is held', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sa-'));
  const file = join(dir, 'token');
  writeFileSync(file, 'eyJhbGciOiJSUzI1NiJ9.payload.sig\n');
  const sa = (url: string, extra: Record<string, string | undefined> = {}) =>
    daguTarget({ NODE_ENV: 'production', DAGU_ALLOW_CLUSTER_HTTP: 'yes', DAGU_AUTH: 'serviceaccount', DAGU_SA_TOKEN_FILE: file, DAGU_URL: url, ...extra });
  it('sends the pod token as the Bearer, read fresh from the file', () => {
    expect(sa('http://dagu-ui.default.svc.cluster.local:8080')).toEqual({ base: 'http://dagu-ui.default.svc.cluster.local:8080', authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig' });
    writeFileSync(file, 'rotated.token.value\n');
    expect(sa('http://dagu-ui.default.svc.cluster.local:8080')?.authorization).toBe('Bearer rotated.token.value');
    writeFileSync(file, 'eyJhbGciOiJSUzI1NiJ9.payload.sig\n');
  });
  it('accepts a realistic token length (about 1000 characters) and refuses an absurd or header-breaking one', () => {
    writeFileSync(file, `${'a'.repeat(1000)}.${'b'.repeat(200)}\n`);
    expect(sa('http://dagu-ui.default.svc.cluster.local:8080')?.authorization).toMatch(/^Bearer a{1000}\.b{200}$/);
    writeFileSync(file, 'a'.repeat(5000));
    expect(sa('http://dagu-ui.default.svc.cluster.local:8080')).toBeNull();
    writeFileSync(file, 'abc def');
    expect(sa('http://dagu-ui.default.svc.cluster.local:8080')).toBeNull();
    writeFileSync(file, 'eyJhbGciOiJSUzI1NiJ9.payload.sig\n');
  });
  it('never sends the pod token off the cluster: an external https host is refused', () => {
    expect(sa('https://dagu.example.org')).toBeNull();
    expect(sa('http://dagu.evil.example:8080')).toBeNull();
  });
  it('is refused alongside any other credential, or when the token file cannot be read', () => {
    expect(sa('http://dagu-ui.default.svc.cluster.local:8080', { DAGU_TOKEN: 'k'.repeat(24) })).toBeNull();
    expect(sa('http://dagu-ui.default.svc.cluster.local:8080', { DAGU_BASIC_USER: 'u', DAGU_BASIC_PASSWORD: 'p' })).toBeNull();
    expect(sa('http://dagu-ui.default.svc.cluster.local:8080', { DAGU_SA_TOKEN_FILE: join(dir, 'missing') })).toBeNull();
  });
});

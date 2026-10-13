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

/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it, vi } from 'vitest';
import { compileJob } from './jobdef/compile';
import { lintTask } from './jobdef/lint';
import { parseJobDef } from './jobdef/parse';
import { checkParam, compilePattern } from './jobdef/params';
import { shellPlaceholderViolations } from './jobdef/templates';
import { isHttpsUrl } from './urls';
import { publicCatalog, loadCatalog, clearCatalogCache, CatalogError } from './catalog/load';
import type { Catalog } from './catalog/load';
import type { CatalogSource } from './catalog/source';
import type { JobDef } from './jobdef/types';

const CTX = { repo: 'org/jobs', sha: 'a'.repeat(40) };
const base = 'schema_version: 1\nid: demo\nname: Demo\nimage: alpine\n';
const parse = (y: string) => { const r = parseJobDef(y); if (!r.ok) throw new Error(r.errors.join('; ')); return r.def; };

describe('a param cannot choose which secret is sent', () => {
  const y = (envLine: string) => `${base}command: [a]\nsecrets: [db]\nparams:\n  - {name: a, label: A, type: string}\n  - {name: b, label: B, type: string}\nenv:\n  P: "${envLine}"\n  Q: secret://db\n`;
  it('rejects mixed placeholder + secret: prefix templates at parse time', () => {
    for (const t of ['secret:/{{a}}', 'secret://{{a}}', 'secret:{{a}}', 'sec{{a}}', 's{{a}}']) expect(parseJobDef(y(t)).ok, t).toBe(false);
  });
  it('rejects {{a}}{{b}} that compile to secret://other', () => {
    const d = parse(y('{{a}}{{b}}'));
    const r = compileJob(d, { a: 'secret:', b: '//other' }, CTX);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/cannot produce a secret reference/);
    expect(compileJob(d, { a: 'x', b: 'y' }, CTX).ok).toBe(true);
  });
  it('compiled-task lint only allows declared secret names', () => {
    const t = { executors: [{ image: 'i', command: ['a'], env: { P: 'secret://other' } }] };
    expect(lintTask(t, { allowSecretRefs: true, declaredSecrets: new Set(['db']) })).toHaveLength(1);
    expect(lintTask(t, { allowSecretRefs: true, declaredSecrets: new Set(['other']) })).toHaveLength(0);
  });
});

describe('ReDoS in param patterns', () => {
  const PROBE = '^a*a*a*a*a*a*a*a*b$';
  it('rejects the probe pattern at parse time', () => {
    const y = `${base}command: [a, "{{x}}"]\nparams:\n  - {name: x, label: X, type: string, pattern: '${PROBE}'}\n`;
    expect(parseJobDef(y).ok).toBe(false);
    expect('error' in compilePattern(PROBE)).toBe(true);
  });
  it('rejects quantified groups, alternation in groups, stacked quantifiers and wide bounded chains', () => {
    for (const p of ['^(a+)+$', '^(a|aa)*$', '^(?:a|b)+$', '^(a){1,9}$', '^a+*$', '^a*a*a*$', '^[a-z]{0,200}[a-z]{0,200}[a-z]{0,200}$', '^(?=a)a$', '^(a)\\1$']) {
      expect('error' in compilePattern(p), p).toBe(true);
    }
  });
  it('still accepts ordinary patterns', () => {
    for (const p of ['^[a-z_]{1,32}$', '^[a-z]+$', '^(foo|bar)-[0-9]{1,6}$', '^[A-Za-z0-9._-]{1,64}$', '^a*b*$']) expect('error' in compilePattern(p), p).toBe(false);
  });
  it('requires max_length <= 256 with a pattern, and never evaluates longer input', () => {
    const y = (ml: number) => `${base}command: [a, "{{x}}"]\nparams:\n  - {name: x, label: X, type: string, pattern: '^[a-z]+$', max_length: ${ml}}\n`;
    expect(parseJobDef(y(256)).ok).toBe(true);
    expect(parseJobDef(y(257)).ok).toBe(false);
    const p = { name: 'x', label: 'X', type: 'string' as const, pattern: '^a*a*b$' };
    expect(checkParam({ ...p, max_length: 4096 }, 'a'.repeat(257)).ok).toBe(false);
  });
  it('hostile input against an accepted pattern stays fast', () => {
    const p = { name: 'x', label: 'X', type: 'string' as const, pattern: '^a*a*b$', max_length: 256 };
    const t0 = performance.now();
    expect(checkParam(p, 'a'.repeat(256)).ok).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('https url checks', () => {
  it('rejects trailing-dot, internal and numeric-label hosts', () => {
    for (const h of ['localhost.', 'foo.internal.', 'metadata.google.internal.', 'svc.cluster.local.', 'x.svc', '169.254.169.254.nip.io', '0x7f.1.example.com', 'intranet', 'a..b.com', '127.0.0.1', 'x.local']) {
      expect(isHttpsUrl(`https://${h}/x`, {}), h).toBe(false);
    }
    expect(isHttpsUrl('https://data.example.org/x', {})).toBe(true);
    expect(isHttpsUrl('https://data.example.org./x', {})).toBe(true);
  });
  it('TES_ALLOWED_URL_HOSTS, when set, is the only accepted set', () => {
    const env = { TES_ALLOWED_URL_HOSTS: 'data.example.org, *.files.example.net' };
    expect(isHttpsUrl('https://data.example.org/a', env)).toBe(true);
    expect(isHttpsUrl('https://a.files.example.net/a', env)).toBe(true);
    for (const u of ['https://other.example.org/a', 'https://files.example.net/a', 'https://evilfiles.example.net/a', 'https://data.example.org.evil.com/a']) expect(isHttpsUrl(u, env), u).toBe(false);
  });
  it('applies to http_url params and https input urls of compiled tasks', () => {
    vi.stubEnv('TES_ALLOWED_URL_HOSTS', 'data.example.org');
    try {
      const d = parse(`${base}command: [a]\nparams:\n  - {name: h, label: H, type: http_url, required: true}\ninputs:\n  - {name: i, url: "{{h}}", path: /d/i}\n`);
      expect(compileJob(d, { h: 'https://data.example.org/a' }, CTX).ok).toBe(true);
      expect(compileJob(d, { h: 'https://other.example.org/a' }, CTX).ok).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });
});

describe('shell-like programs before a placeholder', () => {
  it('rejects env, xargs, awk, busybox, jq', () => {
    for (const prog of ['env', 'xargs', 'awk', 'busybox', 'jq', '/usr/bin/env']) expect(shellPlaceholderViolations([prog, 'x', '{{p}}']), prog).toEqual([2]);
  });
});

describe('catalog failure cache and public view', () => {
  it('caches a failure for 15s, then retries', async () => {
    clearCatalogCache();
    const list = vi.fn(async () => { throw new Error('rate limited'); });
    const src = { kind: 'github', repo: 'o/j', ref: 'main', list, read: vi.fn() } as unknown as CatalogSource;
    await expect(loadCatalog(src)).rejects.toBeInstanceOf(CatalogError);
    await expect(loadCatalog(src)).rejects.toBeInstanceOf(CatalogError);
    expect(list).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ now: Date.now() + 16_000 });
    try { await expect(loadCatalog(src)).rejects.toBeInstanceOf(CatalogError); } finally { vi.useRealTimers(); }
    expect(list).toHaveBeenCalledTimes(2);
    clearCatalogCache();
  });
  it('hides literal env values except secret refs, templates and short non-sensitive ones', () => {
    const def = parse(`${base}command: [a]\nsecrets: [db]\nenv:\n  PYTHONUNBUFFERED: "1"\n  DB_PASSWORD: secret://db\n  API_TOKEN: "opaque-literal-value"\n  LONG: "${'x'.repeat(200)}"\n`);
    const c = { configured: true, repo: 'o/j', ref: 'main', sha: 'a'.repeat(40), fetched_at: null, jobs: [{ def, file: 'a.yaml' }], errors: [] } as Catalog;
    const env = (publicCatalog(c).jobs[0].def as JobDef).env;
    expect(env).toEqual({ PYTHONUNBUFFERED: '1', DB_PASSWORD: 'secret://db', API_TOKEN: '[hidden]', LONG: '[hidden]' });
    expect((c.jobs[0].def as JobDef).env?.API_TOKEN).toBe('opaque-literal-value'); // the cached copy used for compiling is untouched
  });
});

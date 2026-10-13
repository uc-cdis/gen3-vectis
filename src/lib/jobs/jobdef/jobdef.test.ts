/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { compileJob } from './compile';
import { lintTask } from './lint';
import { parseJobDef } from './parse';
import type { JobDef } from './types';
import { shellPlaceholderViolations } from './templates';
import { toTesTask } from '../tes/adapter';
import { EXAMPLE_YAML } from '@/lib/jobs/api/fixtureApi';

const CTX = { repo: 'org/jobs', sha: 'a'.repeat(40) };
const base = `schema_version: 1
id: demo
name: Demo
image: python:3.9-slim
`;
const parse = (y: string) => { const r = parseJobDef(y); if (!r.ok) throw new Error(r.errors.join('; ')); return r.def; };
const errs = (y: string) => { const r = parseJobDef(y); return r.ok ? [] : r.errors.join('\n'); };

describe('parseJobDef: format', () => {
  it('parses both shipped examples', () => {
    for (const f of ['hello', 'log-summary']) expect(parseJobDef(EXAMPLE_YAML[`${f}.yaml`]).ok, f).toBe(true);
  });
  it('rejects unknown keys at every level', () => {
    expect(errs(`${base}command: [a]\nprivileged: true\n`)).toMatch(/privileged/);
    expect(errs(`${base}command: [a]\nresources: {gpu: 1}\n`)).toMatch(/gpu/);
  });
  it('rejects anchors, aliases and merge keys (YAML bombs)', () => {
    const bomb = `${base}command: [a]\nenv:\n  A: &a x\n  B: *a\n`;
    expect(parseJobDef(bomb).ok).toBe(false);
    const lol = 'a: &a [x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: [*b,*b,*b,*b,*b,*b,*b,*b,*b]\n';
    expect(parseJobDef(`${base}command: [a]\n${lol}`).ok).toBe(false);
    expect(parseJobDef(`${base}command: [a]\nx: &m {a: 1}\ny:\n  <<: *m\n`).ok).toBe(false);
  });
  it('rejects oversize, control chars, multi-doc and deep nesting', () => {
    expect(errs(`${base}command: [a]\ndescription: ${'x'.repeat(65 * 1024)}\n`)).toMatch(/64KB/);
    expect(parseJobDef(`${base}command: [a]\u0000`).ok).toBe(false);
    expect(parseJobDef(`${base}command: [a]\n---\nfoo: 1\n`).ok).toBe(false);
    expect(parseJobDef(`${base}command: ${'['.repeat(5000)}`).ok).toBe(false);
    expect(parseJobDef(null).ok).toBe(false);
  });
  it('rejects duplicate keys and bad ids', () => {
    expect(parseJobDef(`${base}command: [a]\ncommand: [b]\n`).ok).toBe(false);
    expect(parseJobDef(`schema_version: 1\nid: "../x"\nname: n\nimage: i\ncommand: [a]\n`).ok).toBe(false);
  });
  it('rejects bad patterns (unanchored, nested quantifiers)', () => {
    const p = (pat: string) => `${base}command: [a, "{{x}}"]\nparams:\n  - {name: x, label: X, type: string, pattern: '${pat}'}\n`;
    expect(parseJobDef(p('^[a-z]+$')).ok).toBe(true);
    expect(parseJobDef(p('[a-z]+')).ok).toBe(false);
    expect(parseJobDef(p('^(a+)+$')).ok).toBe(false);
    expect(parseJobDef(p('^' + 'a'.repeat(130) + '$')).ok).toBe(false);
  });
});

describe('parseJobDef: placeholder rules', () => {
  const cmd = (c: string) => `${base}command: ${c}\nparams:\n  - {name: x, label: X, type: string}\n`;
  it('rejects a placeholder after a shell, -c, or inline interpreter flag', () => {
    for (const c of ['[sh, -c, "echo {{x}}"]', '[bash, -c, "{{x}}"]', '[/bin/zsh, "{{x}}"]', '[dash, "{{x}}"]', '[python, -c, "print({{x}})"]', '[node, -e, "{{x}}"]', '[env, sh, -c, "{{x}}"]', '[eval, "{{x}}"]', '["{{x}}"]', '[tar, -c, "{{x}}"]']) {
      expect(parseJobDef(cmd(c)).ok, c).toBe(false);
    }
    expect(errs(cmd('[sh, -c, "echo {{x}}"]'))).toMatch(/shell/);
  });
  it('allows a literal shell script and placeholders as plain argv', () => {
    expect(parseJobDef(cmd('[sh, -c, "echo hi"]')).ok).toBe(true);
    expect(parseJobDef(cmd('[python, run.py, "{{x}}"]')).ok).toBe(true);
    expect(shellPlaceholderViolations(['python', 'run.py', '{{x}}'])).toEqual([]);
  });
  it('rejects undeclared and malformed placeholders and placeholders in image/paths', () => {
    expect(errs(`${base}command: [a, "{{nope}}"]\n`)).toMatch(/undeclared/);
    expect(errs(cmd('[a, "{{x"]'))).toMatch(/malformed/);
    expect(parseJobDef(`schema_version: 1\nid: d\nname: n\nimage: "x{{y}}"\ncommand: [a]\n`).ok).toBe(false);
  });
  it('restricts url params and {{user_bucket}} to url fields', () => {
    const y = (u: string, c = '[a]') => `${base}command: ${c}\nparams:\n  - {name: u, label: U, type: s3_url}\ninputs:\n  - {name: i, url: "${u}", path: /d/i}\n`;
    expect(parseJobDef(y('{{u}}')).ok).toBe(true);
    expect(parseJobDef(y('s3://b/{{u}}')).ok).toBe(false);
    expect(parseJobDef(y('s3://{{user_bucket}}/x')).ok).toBe(true);
    expect(parseJobDef(y('s3://b/x', '[a, "{{user_bucket}}"]')).ok).toBe(false);
  });
});

describe('credential lint (definitions)', () => {
  const env = (v: string, k = 'API_KEY') => `${base}command: [a]\nenv:\n  ${k}: "${v}"\n`;
  it('rejects literal credentials', () => {
    const bad: Array<[string, string?]> = [
      ['AKIAIOSFODNN7EXAMPLE', 'X'], ['ASIAIOSFODNN7EXAMPLE', 'X'],
      ['wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'AWS_SECRET_ACCESS_KEY'],
      ['-----BEGIN RSA PRIVATE KEY-----', 'X'], ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij', 'X'],
      ['ghp_' + 'a'.repeat(36), 'X'], ['github_pat_' + 'A'.repeat(30), 'X'], ['xoxb-1234567890-abcdefghij', 'X'],
    ];
    for (const [v, k] of bad) expect(parseJobDef(env(v, k)).ok, v).toBe(false);
  });
  it('accepts secret:// (declared) and rejects undeclared or malformed refs', () => {
    expect(parseJobDef(`${base}command: [a]\nsecrets: [db]\nenv:\n  DB_PASSWORD: secret://db\n`).ok).toBe(true);
    expect(errs(`${base}command: [a]\nenv:\n  DB_PASSWORD: secret://db\n`)).toMatch(/not listed/);
    expect(parseJobDef(`${base}command: [a]\nsecrets: [db]\nenv:\n  P: "secret://a b"\n`).ok).toBe(false);
  });
  it('rejects the owner-style hardcoded keys inside a mounted script', () => {
    const t = lintTask({ executors: [{ image: 'i', command: ['python', '-c', "boto3.client('s3', aws_access_key_id='AKIAIOSFODNN7EXAMPLE', aws_secret_access_key='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')"] }], inputs: [{ path: '/s.py', content: "aws_secret_access_key = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'" }] });
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(t)).not.toContain('wJalr'); // messages never echo the credential
  });
});

describe('compileJob', () => {
  const def = (extra = '', params = '') => parse(`${base}command: [python, run.py, "{{x}}"]\nparams:\n  - {name: x, label: X, type: string, required: true${params}}\n${extra}`);
  const c = (d: JobDef, v: Record<string, unknown>, ctx: Parameters<typeof compileJob>[2] = CTX) => compileJob(d, v, ctx);

  it('adds provenance tags and substitutes values into argv', () => {
    const r = c(def(), { x: 'hello' });
    expect(r.ok && r.spec.tags).toEqual({ 'vectis.job': 'demo', 'vectis.catalog_sha': CTX.sha, 'vectis.catalog_repo': 'org/jobs' });
    expect(r.ok && r.spec.steps[0].command).toEqual(['python', 'run.py', 'hello']);
  });
  it('rejects a value starting with - unless allow_leading_dash', () => {
    expect(c(def(), { x: '--rm-rf' }).ok).toBe(false);
    expect(c(def('', ', allow_leading_dash: true'), { x: '--ok' }).ok).toBe(true);
    const embedded = parse(`${base}command: [a, "--name={{x}}"]\nparams:\n  - {name: x, label: X, type: string}\n`);
    expect(c(embedded, { x: '-v' }).ok).toBe(true); // not a whole element
  });
  it('validates params before substitution: type, enum, range, pattern, length, controls', () => {
    const d = parse(`${base}command: [a, "{{n}}", "{{e}}", "{{s}}", "{{b}}"]
params:
  - {name: n, label: N, type: integer, min: 1, max: 5, required: true}
  - {name: e, label: E, type: enum, values: [a, b], required: true}
  - {name: s, label: S, type: string, pattern: "^[a-z]+$", max_length: 5, required: true}
  - {name: b, label: B, type: boolean, required: true}
`);
    const good = { n: 3, e: 'a', s: 'abc', b: true };
    expect(c(d, good).ok).toBe(true);
    for (const bad of [{ n: 0 }, { n: 6 }, { n: 1.5 }, { n: 'x' }, { e: 'c' }, { s: 'ABC' }, { s: 'abcdef' }, { s: 'ab\n' }, { s: 'a\u0000' }, { b: 'yes' }, { extra: 1 }]) {
      expect(c(d, { ...good, ...bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it('rejects missing required params and substitution is single-pass', () => {
    expect(c(def(), {}).ok).toBe(false);
    const r = c(def(), { x: '{{x}}' });
    expect(r.ok && r.spec.steps[0].command[2]).toBe('{{x}}'); // not re-evaluated
  });
  it('s3_url and http_url enforce their shapes', () => {
    const d = parse(`${base}command: [a]\nparams:\n  - {name: u, label: U, type: s3_url, required: true}\n  - {name: h, label: H, type: http_url}\noutputs:\n  - {name: o, url: "{{u}}", path: /o}\n`);
    expect(c(d, { u: 's3://my-bucket/path/key.json' }).ok).toBe(true);
    for (const u of ['s3://my-bucket', 's3://my-bucket/../x', 's3://b/a b', 'http://x.com/a', 's3://my-bucket/a\nb', 'https://x.com', 's3://my-bucket/a?x=1']) expect(c(d, { u }).ok, u).toBe(false);
    expect(c(d, { u: 's3://my-bucket/k', h: 'https://example.org/a' }).ok).toBe(true);
    for (const h of ['http://example.org/a', 'https://user:pw@example.org/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://example.org/a b']) expect(c(d, { u: 's3://my-bucket/k', h }).ok, h).toBe(false);
  });
  it('a string param cannot change the shape of a url', () => {
    const d = parse(`${base}command: [a]\nparams:\n  - {name: k, label: K, type: string, required: true}\noutputs:\n  - {name: o, url: "s3://my-bucket/out/{{k}}", path: /o}\n`);
    expect(c(d, { k: 'run1.json' }).ok).toBe(true);
    for (const k of ['../x', 'a?b', 'a b', '..']) expect(c(d, { k }).ok, k).toBe(false);
  });
  it('a param cannot smuggle a credential or choose a secret reference', () => {
    expect(c(def(), { x: 'AKIAIOSFODNN7EXAMPLE' }).ok).toBe(false);
    const d = parse(`${base}command: [a]\nsecrets: [db]\nparams:\n  - {name: x, label: X, type: string}\nenv:\n  P: "{{x}}"\n  Q: secret://db\n`);
    expect(c(d, { x: 'secret://other' }).ok).toBe(false);
    expect(c(d, { x: 'plain' }).ok).toBe(true);
  });
  it('passes secret:// through unresolved with a warning', () => {
    const d = parse(`${base}command: [a]\nsecrets: [db]\nenv:\n  DB_PASSWORD: secret://db\n`);
    const r = c(d, {});
    expect(r.ok && r.spec.steps[0].env).toEqual({ DB_PASSWORD: 'secret://db' });
    expect(r.ok && r.spec.warnings.join(' ')).toMatch(/depends on the runner/);
  });
  it('fills {{user_bucket}} from context only, and refuses when missing or odd', () => {
    const d = parse(`${base}command: [a]\noutputs:\n  - {name: o, url: "s3://{{user_bucket}}/results/", path: /o}\n`);
    const r = c(d, {}, { ...CTX, userBucket: 'user-bkt-1' });
    expect(r.ok && r.spec.outputs[0].url).toBe('s3://user-bkt-1/results/');
    expect(c(d, {}).ok).toBe(false);
    expect(c(d, {}, { ...CTX, userBucket: 'b/../x' }).ok).toBe(false);
  });
  it('builds chained executors and rejects a bad catalog context', () => {
    const d = parse(`${base}command: [a]\nexecutors_after:\n  - {image: alpine, command: [echo, done]}\n`);
    const r = c(d, {});
    expect(r.ok && r.spec.steps).toHaveLength(2);
    expect(c(d, {}, { repo: '../x', sha: 'zz zz' }).ok).toBe(false);
  });
  it('the TES view of a spec is byte-identical to the task the old compiler produced', () => {
    const d = parse(`${base}description: D\ncommand: [python, run.py, "{{x}}"]\nparams:\n  - {name: x, label: X, type: string, required: true}\nenv:\n  A: "1"\ninputs:\n  - {name: i, url: "s3://my-bucket/in", path: /in}\noutputs:\n  - {name: o, url: "s3://my-bucket/out", path: /o}\nresources: {cpu_cores: 2, ram_gb: 4}\nexecutors_after:\n  - {image: alpine, command: [echo, done], workdir: /w}\n`);
    const r = c(d, { x: 'v' });
    expect(r.ok && JSON.stringify(toTesTask(r.spec))).toBe(JSON.stringify({
      name: 'Demo', description: 'D',
      executors: [{ image: 'python:3.9-slim', command: ['python', 'run.py', 'v'], env: { A: '1' } }, { image: 'alpine', command: ['echo', 'done'], workdir: '/w' }],
      inputs: [{ name: 'i', url: 's3://my-bucket/in', path: '/in', type: 'FILE' }],
      outputs: [{ name: 'o', url: 's3://my-bucket/out', path: '/o', type: 'FILE' }],
      resources: { cpu_cores: 2, ram_gb: 4 },
      tags: { 'vectis.job': 'demo', 'vectis.catalog_sha': CTX.sha, 'vectis.catalog_repo': 'org/jobs' },
    }));
  });
});

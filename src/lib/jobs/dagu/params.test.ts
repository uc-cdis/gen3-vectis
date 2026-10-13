/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { compileDagJob } from '../jobdef/compile';
import { parseDagEntry } from '../jobdef/parse';
import type { DagJobDef, JobParam } from '../jobdef/types';
import { SAFE_STRING, SAFE_VALUE, assertInertValues, checkDagParam, dagEnumProblems } from './params';

const str = (extra: Partial<JobParam> = {}): JobParam => ({ name: 'p', label: 'P', type: 'string', ...extra });
const META = [' ', '\t', '\n', '\r', '\u0000', '"', "'", ';', '|', '&', '$', '`', '<', '>', '(', ')', '{', '}', '\\', '*', '!', '[', ']', ' ', ' ', '\u007f', 'é', '‮'];

describe('string params: strict charset, whatever the declared pattern says', () => {
  it('accepts plain tokens', () => {
    for (const v of ['alpha', 'a-b_c.d', 'host:8080', 'a/b/c', 'user@example.org', 'a+b=c,d', '100%25', '198.51.100.7', '2001:db8::1']) expect(checkDagParam(str(), v), v).toMatchObject({ ok: true });
  });
  it.each(META)('refuses %j anywhere in the value', (m) => {
    for (const v of [`a${m}b`, `${m}ab`, `ab${m}`, m]) expect(checkDagParam(str(), v).ok, JSON.stringify(v)).toBe(false);
  });
  it('refuses a leading dash (option injection) unless the author allowed it', () => {
    expect(checkDagParam(str(), '-rf').ok).toBe(false);
    expect(checkDagParam(str(), '--x=y').ok).toBe(false);
    expect(checkDagParam(str({ allow_leading_dash: true }), '-v')).toMatchObject({ ok: true });
    expect(checkDagParam(str(), 'a-b')).toMatchObject({ ok: true });
  });
  it('a permissive declared pattern cannot widen the charset', () => {
    const p = str({ pattern: '^.{1,40}$' });
    for (const v of ['a b', 'a;b', '$(id)', '`id`', 'a|b', 'a&b', "a'b", 'a"b', 'a\\b', 'a<b', 'a>b', 'a(b', 'a{b']) expect(checkDagParam(p, v).ok, v).toBe(false);
  });
  it('still enforces the normal rules first (length, control characters, secret references)', () => {
    expect(checkDagParam(str({ max_length: 3 }), 'abcd').ok).toBe(false);
    expect(checkDagParam(str(), 'secret://x').ok).toBe(false);
    expect(checkDagParam(str(), 5).ok).toBe(false);
  });
  it('the charsets themselves contain no shell metacharacter', () => {
    for (const m of META.filter((x) => x !== 'é')) { expect(SAFE_STRING.test(`a${m}`)).toBe(false); expect(SAFE_VALUE.test(`a${m}`)).toBe(false); }
  });
});

describe('structured types', () => {
  it('integer/number/boolean are re-serialised from a parsed value, so text cannot ride along', () => {
    expect(checkDagParam({ ...str(), type: 'integer' }, 5)).toEqual({ ok: true, value: '5' });
    expect(checkDagParam({ ...str(), type: 'integer' }, '-5')).toEqual({ ok: true, value: '-5' }); // a negative number may start with '-'
    expect(checkDagParam({ ...str(), type: 'number' }, '1.5')).toEqual({ ok: true, value: '1.5' });
    expect(checkDagParam({ ...str(), type: 'boolean' }, 'true')).toEqual({ ok: true, value: 'true' });
    for (const bad of ['1;id', '1 2', '$(id)', '0x10', '1e3', '١']) expect(checkDagParam({ ...str(), type: 'integer' }, bad).ok, bad).toBe(false);
    expect(checkDagParam({ ...str(), type: 'boolean' }, 'true;id').ok).toBe(false);
  });
  it('s3_url and http_url must be valid urls AND shell-inert', () => {
    const s3 = { ...str(), type: 's3_url' as const };
    const http = { ...str(), type: 'http_url' as const };
    expect(checkDagParam(s3, 's3://bucket-name/some/key.txt')).toMatchObject({ ok: true });
    expect(checkDagParam(http, 'https://example.org/a/b?x=1&y=2')).toMatchObject({ ok: false }); // '&' is shell syntax: percent-encode it
    expect(checkDagParam(http, 'https://example.org/a/b?x=1%26y=2#frag')).toMatchObject({ ok: true });
    for (const tail of ['$(id)', '`id`', ';id', '|id', '&&id', '"', "'", '<x', '>x', '(x)', '{x}', '\\x', '*', '!', '[x]']) {
      expect(checkDagParam(http, `https://example.org/${tail}`).ok, tail).toBe(false);
    }
    expect(checkDagParam(http, 'http://example.org/').ok).toBe(false);
    expect(checkDagParam(http, 'https://localhost/').ok).toBe(false);
    expect(checkDagParam(s3, 's3://bucket/key with space').ok).toBe(false);
  });
  it('enum: the value must be listed, and the author\'s listed values must themselves be inert', () => {
    const e = { ...str(), type: 'enum' as const, values: ['daily', 'weekly'] };
    expect(checkDagParam(e, 'daily')).toMatchObject({ ok: true });
    expect(checkDagParam(e, 'daily;id').ok).toBe(false);
    expect(dagEnumProblems({ ...e, values: ['ok', 'a b', 'x;y', '$(z)'] })).toHaveLength(3);
    expect(dagEnumProblems(e)).toEqual([]);
  });
});

describe('assertInertValues (the runner\'s own last check; it does not know types)', () => {
  it('passes inert values, including a negative number and a url', () => {
    expect(assertInertValues({ a: 'x', n: '-5', u: 'https://example.org/a?b=c#d', k: '' })).toBeNull();
  });
  it('fails every metacharacter, any name that is not an identifier, and over-large sets', () => {
    for (const m of META.filter((x) => x !== 'é' && x !== ' ' )) expect(assertInertValues({ a: `x${m}y` }), JSON.stringify(m)).not.toBeNull();
    for (const k of ['a b', '1a', '', '__proto__x;', 'a-b', 'a.b']) expect(assertInertValues({ [k]: 'x' })).not.toBeNull();
    expect(assertInertValues(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`p${i}`, 'x'])))).not.toBeNull();
    expect(assertInertValues({ a: 'x'.repeat(5000) })).not.toBeNull();
  });
});

describe('compileDagJob', () => {
  const def: DagJobDef = { schema_version: 1, kind: 'dag', engine: 'dagu', id: 'dag-x', name: 'X', definition: 'dags/x.yaml', params: [str({ name: 'label', required: true, pattern: '^.{1,20}$' }), { name: 'n', label: 'N', type: 'integer', default: 3, min: 1, max: 10 }] };
  const native = { text: 'name: x\nsteps: []\n', dag_name: 'x' };
  const ctx = { repo: 'org/jobs', sha: 'a'.repeat(40) };
  it('carries the native text unchanged, the validated params as strings, and only the three catalog tags', () => {
    const c = compileDagJob(def, native, { label: 'hello', n: 4 }, ctx);
    expect(c).toMatchObject({ ok: true });
    if (!c.ok) return;
    expect(c.spec.dag).toEqual({ engine: 'dagu', definition: native.text, dag_name: 'x', params: { label: 'hello', n: '4' } });
    expect(c.spec.tags).toEqual({ 'vectis.job': 'dag-x', 'vectis.catalog_sha': 'a'.repeat(40), 'vectis.catalog_repo': 'org/jobs' });
    expect(c.spec.steps).toEqual([]);
  });
  it('applies defaults, requires required params, rejects unknown params and hostile values', () => {
    expect(compileDagJob(def, native, {}, ctx)).toMatchObject({ ok: false });
    expect(compileDagJob(def, native, { label: 'a', n: undefined }, ctx)).toMatchObject({ ok: true });
    const c = compileDagJob(def, native, { label: 'a' }, ctx);
    expect(c.ok && c.spec.dag?.params.n).toBe('3');
    expect(compileDagJob(def, native, { label: 'a', extra: 'b' }, ctx)).toMatchObject({ ok: false });
    for (const v of ['a b', 'a;b', '$(id)', '-x']) expect(compileDagJob(def, native, { label: v }, ctx), v).toMatchObject({ ok: false });
    expect(compileDagJob(def, native, { label: 'a', n: 99 }, ctx)).toMatchObject({ ok: false });
    expect(compileDagJob(def, native, ['x'] as never, ctx)).toMatchObject({ ok: false });
  });
});

describe('catalog entry (kind: dag) schema', () => {
  const entry = (extra = '') => `schema_version: 1\nkind: dag\nengine: dagu\nid: a\nname: A\ndefinition: dags/a.yaml\n${extra}`;
  it('accepts the documented shape', () => { expect(parseDagEntry(entry('params:\n  - {name: p, label: P, type: string}\n'))).toMatchObject({ ok: true }); });
  it('refuses a definition path that could leave the catalog, another engine, unknown keys and bad enum values', () => {
    for (const d of ['../x.yaml', '/etc/passwd', 'dags/../x.yaml', 'dags//x.yaml', 'x.txt', 'a/b/c/d/e/f.yaml', '.hidden.yaml', 'https://evil/x.yaml', 'dags/x.yaml?ref=other', 'dags\\x.yaml']) {
      expect(parseDagEntry(entry().replace('dags/a.yaml', d.replace(/"/g, ''))).ok, d).toBe(false);
    }
    expect(parseDagEntry(entry().replace('dagu', 'argo')).ok).toBe(false);
    expect(parseDagEntry(`${entry()}image: alpine\n`).ok).toBe(false);
    expect(parseDagEntry(`${entry()}command: [x]\n`).ok).toBe(false);
    expect(parseDagEntry(entry('params:\n  - {name: p, label: P, type: enum, values: ["a b"]}\n')).ok).toBe(false);
    expect(parseDagEntry('schema_version: 1\nkind: container\nid: a\nname: A\n').ok).toBe(false);
  });
});

/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { LaunchSpec } from '../launch';
import { RunnerError } from '../runner';
import { identityOrder } from '../portal';
import { parseRunQuery } from '../routes';
import { GET_DEADLINE_MS, createDaguRunner, ownerHash } from './daguRunner';
import { createFakeDagu } from '@/lib/jobs/testing/fakeDagu';
import { DAG_FANOUT } from '../testing/definitions';

/** Security regressions at the Dagu runner level (the lint cases are in lint.security.test.ts). */
const SECRET = 'tok-0123456789abcdef';
const KEY = 'k'.repeat(40);
const ENV = { NODE_ENV: 'test', DAGU_URL: 'http://dagu.test:8080', DAGU_TOKEN: SECRET, JOBS_OWNER_HMAC_KEY: KEY, DAGU_ALLOWED_EXECUTORS: 'command' };
const alice = { user: 'alice@example.org', token: 't' };
const spec = (definition = DAG_FANOUT): LaunchSpec => ({ name: 'x', steps: [], inputs: [], outputs: [], secrets: [], warnings: [], tags: {}, dag: { engine: 'dagu', definition, dag_name: 'fanout', params: { label: 'a' } } });
let fake: ReturnType<typeof createFakeDagu>;
let env: Record<string, string | undefined>;
const runner = () => createDaguRunner(() => env);
const failure = async (p: Promise<unknown>): Promise<RunnerError> => { const e = await p.then(() => null, (x: unknown) => x); expect(e).toBeInstanceOf(RunnerError); return e as RunnerError; };
beforeEach(() => { env = { ...ENV }; fake = createFakeDagu({ authorization: `Bearer ${SECRET}` }); vi.stubGlobal('fetch', fake.fetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Dagu gets the linted document, re-serialised', () => {
  it('what is sent is the parsed object written out again: comments and original bytes are gone, content is equal', async () => {
    const def = `# a comment that must not travel\n${DAG_FANOUT}`;
    await runner().submit(spec(def), alice);
    const sent = (fake.calls[0].body as { spec: string }).spec;
    expect(sent).not.toContain('a comment that must not travel');
    expect(sent).not.toBe(def);
    expect(parse(sent)).toEqual(parse(def));
  });
  it('a definition with a parser-differential character is refused at submit', async () => {
    for (const c of ['\u0085', ' ', '‮', '​', '﻿']) expect((await failure(runner().submit(spec(DAG_FANOUT.replace('demo', `de${c}mo`)), alice))).status, JSON.stringify(c)).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('the owner label is an HMAC under a server secret', () => {
  it('requires JOBS_OWNER_HMAC_KEY of at least 32 bytes, for every call, before anything is sent', async () => {
    for (const k of [undefined, '', 'short', 'k'.repeat(31)]) {
      env = { ...ENV, JOBS_OWNER_HMAC_KEY: k };
      for (const p of [runner().list({}, alice), runner().get('fanout.abc', alice), runner().cancel('fanout.abc', alice), runner().submit(spec(), alice)]) {
        const e = await failure(p);
        expect(e.status).toBe(503);
        expect(e.message).toMatch(/JOBS_OWNER_HMAC_KEY/);
      }
    }
    env = { ...ENV, JOBS_OWNER_HMAC_KEY: 'é'.repeat(16) }; // 16 chars but 32 bytes: enough
    await runner().list({}, alice);
    expect(fake.calls).toHaveLength(1);
  });
  it('labels with HMAC(user), not SHA-256(user): a run planted with the unkeyed hash is invisible', async () => {
    const { createHash } = await import('node:crypto');
    const plain = createHash('sha256').update('alice@example.org').digest('hex');
    await runner().submit(spec(), alice);
    const labels = (fake.calls[0].body as { labels: string[] }).labels;
    const owner = labels.find((l) => l.startsWith('vectis.owner='))?.slice(13);
    expect(owner).toBe(ownerHash('alice@example.org', KEY));
    expect(owner).not.toBe(plain);
    fake.runs.push({ name: 'fanout', id: 'planted', labels: [`vectis.owner=${plain}`], params: '', status: 1, label: 'running', nodes: [], created: 9 });
    expect((await failure(runner().get('fanout.planted', alice))).status).toBe(404);
    expect((await runner().list({}, alice)).runs.map((r) => r.id)).not.toContain('fanout.planted');
  });
  it('changing the key orphans existing runs (documented): the same user no longer sees them', async () => {
    const { id } = await runner().submit(spec(), alice);
    expect((await runner().get(id, alice)).id).toBe(id);
    env = { ...ENV, JOBS_OWNER_HMAC_KEY: 'z'.repeat(40) };
    expect((await failure(runner().get(id, alice))).status).toBe(404);
    expect((await runner().list({}, alice)).runs).toEqual([]);
  });
});

describe('logs are bounded, on demand, and under one deadline', () => {
  const many = (n: number) => `name: many\ntype: graph\nsteps:\n${Array.from({ length: n }, (_, i) => `  - id: s${i}\n    run: echo ${i}\n`).join('')}`;
  it('by default fetches logs only for failed/running steps (at most 8), not for every step', async () => {
    const { id } = await runner().submit({ ...spec(many(40)), dag: { engine: 'dagu', definition: many(40), dag_name: 'many', params: {} } }, alice);
    const [name, rid] = id.split('.');
    fake.settle(name, rid, 2, Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`s${i}`, i < 12 ? 2 : 4])));
    const before = fake.calls.length;
    const run = await runner().get(id, alice);
    const logCalls = fake.calls.slice(before).filter((c) => c.path.includes('/log'));
    expect(logCalls.length).toBeLessThanOrEqual(16);
    expect(run.steps.filter((s) => s.logs_loaded === false && s.state === 'succeeded').length).toBe(28); // started but not fetched: the UI offers "load logs"
    expect(run.steps[0].logs_loaded).toBe(true);
  });
  it('fetches exactly the steps asked for', async () => {
    const { id } = await runner().submit({ ...spec(many(5)), dag: { engine: 'dagu', definition: many(5), dag_name: 'many', params: {} } }, alice);
    const [name, rid] = id.split('.');
    fake.settle(name, rid, 4);
    fake.logs.set(`${name}/${rid}/s3`, { stdout: 'three\n', stderr: '' });
    const before = fake.calls.length;
    const run = await runner().get(id, alice, { steps: ['s3', 'nope', '../x'] });
    expect(fake.calls.slice(before).filter((c) => c.path.includes('/log')).map((c) => c.path.split('/steps/')[1].split('/')[0])).toEqual(['s3', 's3']);
    expect(run.steps[3]).toMatchObject({ stdout: 'three\n', logs_loaded: true });
    expect(run.steps[1].logs_loaded).toBe(false);
  });
  it('get() has one overall deadline: a hanging log fetch cannot hold the request past it', async () => {
    const { id } = await runner().submit(spec(), alice);
    const real = fake.fetch;
    vi.stubGlobal('fetch', ((u: string, i: RequestInit) => String(u).includes('/log')
      ? new Promise((_, rej) => { i.signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); })
      : real(u, i)) as typeof fetch);
    vi.useFakeTimers();
    const p = runner().get(id, alice);
    await vi.advanceTimersByTimeAsync(GET_DEADLINE_MS + 1000);
    const run = await p;
    expect(run.id).toBe(id);
    expect(run.steps.every((s) => s.stdout === '')).toBe(true);
  });
  it('the step query is validated: names only, at most 8', () => {
    const get = { kind: 'get', id: 'a.b' } as const;
    expect(parseRunQuery(get, { step: ['a', 'b_1'] })).toMatchObject({ ok: true, query: { steps: ['a', 'b_1'] } });
    for (const bad of ['../x', 'a b', 'a;b', '', 'x'.repeat(65), Array.from({ length: 9 }, () => 'a')]) expect(parseRunQuery(get, { step: bad }).ok, JSON.stringify(bad)).toBe(false);
    expect(parseRunQuery({ kind: 'list' }, { step: 'a' }).ok).toBe(false);
  });
});

describe('identity for Dagu is email or username, never the display name', () => {
  it('JOBS_RUNNER=dagu drops name from the identity order; TES keeps it', () => {
    expect(identityOrder({ JOBS_RUNNER: 'dagu' })).toEqual(['email', 'username']);
    expect(identityOrder({ JOBS_RUNNER: ' dagu ' })).toEqual(['email', 'username']);
    expect(identityOrder({})).toEqual(['email', 'username', 'name']);
    expect(identityOrder({ JOBS_RUNNER: 'tes' })).toEqual(['email', 'username', 'name']);
  });
});

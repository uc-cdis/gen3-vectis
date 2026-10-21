/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchSpec } from '../launch';
import { RunnerError } from '../runner';
import { createDaguRunner } from './daguRunner';
import { inGroup } from './map';
import { createFakeDagu } from '@/lib/jobs/testing/fakeDagu';
import { DAG_FANOUT } from '../testing/definitions';

const SECRET = 'S3cretServiceToken-0123456789';
const ENV = { NODE_ENV: 'test', JOBS_OWNER_HMAC_KEY: 'k'.repeat(40), DAGU_URL: 'http://dagu.test:8080', DAGU_TOKEN: SECRET, DAGU_ALLOWED_EXECUTORS: 'command,http,jq' };
const alice = { user: 'alice@example.org', token: 'a', groups: ['soc'] };
const bob = { user: 'bob@example.org', token: 'b', groups: ['soc'] };
const carol = { user: 'carol@example.org', token: 'c', groups: [] as string[] };
const spec = (): LaunchSpec => ({
  name: 'Fan-out', steps: [], inputs: [], outputs: [], secrets: [], warnings: [],
  dag: { engine: 'dagu', definition: DAG_FANOUT, dag_name: 'fanout', params: { label: 'alpha' } },
  tags: { 'vectis.job': 'dag-fanout', 'vectis.catalog_sha': 'a'.repeat(40), 'vectis.catalog_repo': 'org/jobs', 'vectis.group': 'platform' }, // a forged group tag
});
let fake: ReturnType<typeof createFakeDagu>;
beforeEach(() => { fake = createFakeDagu({ authorization: `Bearer ${SECRET}` }); vi.stubGlobal('fetch', fake.fetch); });
afterEach(() => vi.unstubAllGlobals());
const runner = () => createDaguRunner(() => ENV);
const failure = async (p: Promise<unknown>): Promise<RunnerError> => { const e = await p.then(() => null, (x: unknown) => x); expect(e).toBeInstanceOf(RunnerError); return e as RunnerError; };

describe('group runs', () => {
  it('carry the group label the runner sets itself, never one from the tags', async () => {
    await runner().submit(spec(), alice, { group: 'soc' });
    const labels = (fake.calls[0].body as { labels: string[] }).labels;
    expect(labels.filter((l) => l.startsWith('vectis.group='))).toEqual(['vectis.group=soc']);
    await runner().submit(spec(), alice);
    expect(((fake.calls.at(-1)?.body as { labels: string[] }).labels).some((l) => l.startsWith('vectis.group='))).toBe(false);
  });
  it('are refused for a group the caller is not in, before Dagu is called', async () => {
    for (const [ctx, g] of [[carol, 'soc'], [alice, 'platform'], [alice, '../x']] as const) {
      const e = await failure(runner().submit(spec(), ctx, { group: g }));
      expect(e.status).toBe(403);
    }
    expect(fake.calls).toHaveLength(0);
  });
  it('can be opened and cancelled by another member, not by a person outside the group, and a personal run only by its owner', async () => {
    const group = await runner().submit(spec(), alice, { group: 'soc' });
    const personal = await runner().submit(spec(), alice);
    expect((await runner().get(group.id, bob, { detail: 'summary' })).group).toBe('soc');
    await runner().cancel(group.id, bob).catch((e: unknown) => { expect((e as RunnerError).status).not.toBe(404); }); // allowed: it may answer 409 once finished
    expect((await failure(runner().get(group.id, carol, { detail: 'summary' }))).status).toBe(404);
    expect((await failure(runner().get(personal.id, bob, { detail: 'summary' }))).status).toBe(404);
    expect((await runner().get(personal.id, alice, { detail: 'summary' })).id).toBe(personal.id);
  });
  it('a group label alone, or a repeated one, is not enough', () => {
    expect(inGroup(['vectis.group=soc', 'vectis.owner=x'], ['soc'])).toBe(true);
    expect(inGroup(['vectis.group=soc'], ['soc'])).toBe(false); // no owner label
    expect(inGroup(['vectis.group=soc', 'vectis.group=platform', 'vectis.owner=x'], ['soc', 'platform'])).toBe(false);
    expect(inGroup(['vectis.group=soc', 'vectis.owner=x'], [])).toBe(false);
    expect(inGroup(['vectis.group=soc', 'vectis.owner=x'], undefined)).toBe(false);
    expect(inGroup('nonsense', ['soc'])).toBe(false);
  });
});

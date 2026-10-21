/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { LaunchSpec } from '../launch';
import { RunnerError } from '../runner';
import { parseDagEntry, parseJobDef } from '../jobdef/parse';
import { compileDagJob } from '../jobdef/compile';
import { createDaguRunner, kubernetesBlock } from './daguRunner';
import { createFakeDagu } from '@/lib/jobs/testing/fakeDagu';

const KEY = 'sk-live_ABCDEFGHIJKLMNOP.1234567890';
const entry = (extra = '') => `schema_version: 1
kind: dag
engine: dagu
id: ask
name: Ask
definition: dags/ask.yaml
params:
  - name: bifrost_token
    label: AI key
    type: secret
    env: BIFROST_API_KEY
${extra}  - name: days
    label: Days
    type: integer
    default: 7
`;
const parseOk = (y: string) => { const r = parseDagEntry(y); if (!r.ok) throw new Error(r.errors.join('; ')); return r.def; };
const parseErrors = (y: string) => { const r = parseDagEntry(y); return r.ok ? [] : r.errors.join('\n'); };
const NATIVE = { text: 'steps:\n  - id: s1\n    action: k8s.run\n    with:\n      image: quay.io/cdis/tool:1\n      command: echo hi\n', dag_name: 'ask' };
const CTX = { repo: 'org/jobs', sha: 'a'.repeat(40) };

describe('secret params in a catalog entry', () => {
  it('are accepted on a workflow entry with a credential-shaped variable name', () => {
    expect(parseOk(entry()).params?.[0]).toMatchObject({ type: 'secret', env: 'BIFROST_API_KEY' });
  });
  it.each([
    ['no env', entry().replace('    env: BIFROST_API_KEY\n', ''), 'needs env'],
    ['a plain name', entry().replace('BIFROST_API_KEY', 'MODE'), 'must be UPPER_CASE'],
    ['a platform name', entry().replace('BIFROST_API_KEY', 'AWS_SESSION_TOKEN'), 'reserved'],
    ['the token override', entry().replace('BIFROST_API_KEY', 'ACCESS_TOKEN'), 'reserved'],
    ['a runner name', entry().replace('BIFROST_API_KEY', 'RUNNER_RESULTS_TOKEN'), 'reserved'],
    ['a default', entry('    default: abcdefgh\n'), 'default is not allowed'],
    ['a pattern', entry('    pattern: "^.*$"\n'), 'pattern is not allowed'],
  ])('are refused with %s', (_n, y, msg) => { expect(parseErrors(y)).toContain(msg); });
  it('cannot share a variable', () => {
    const y = entry() + '  - name: other\n    label: Other\n    type: secret\n    env: BIFROST_API_KEY\n';
    expect(parseErrors(y)).toContain('used by another param');
  });
  it('are for workflow entries only: a container job refuses them', () => {
    const r = parseJobDef('schema_version: 1\nid: j\nname: J\nimage: quay.io/cdis/tool:1\ncommand: [echo, hi]\nparams:\n  - {name: k, label: K, type: secret, env: X_API_KEY}\n');
    expect(r.ok).toBe(false);
  });
  it('an env on a non-secret param is refused', () => {
    expect(parseErrors(entry().replace('    label: Days\n', '    label: Days\n    env: X_API_KEY\n'))).toContain('env is only for secret params');
  });
});

describe('compiling a run', () => {
  it('keeps the value out of params, tags and the definition, and hands it over as secret_env', () => {
    const r = compileDagJob(parseOk(entry()), NATIVE, { bifrost_token: KEY, days: 3 }, CTX);
    if (!r.ok) throw new Error(r.errors.join(';'));
    expect(r.spec.dag?.secret_env).toEqual([{ name: 'BIFROST_API_KEY', value: KEY }]);
    expect(r.spec.dag?.params).toEqual({ days: '3' });
    expect(JSON.stringify({ ...r.spec, dag: { ...r.spec.dag, secret_env: undefined } })).not.toContain(KEY);
  });
  it('treats an empty or missing optional secret as not given', () => {
    for (const v of [undefined, '', null]) {
      const r = compileDagJob(parseOk(entry()), NATIVE, { bifrost_token: v }, CTX);
      expect(r.ok && r.spec.dag?.secret_env).toBeFalsy();
    }
  });
  it('requires a required secret', () => {
    const def = parseOk(entry('    required: true\n'));
    const r = compileDagJob(def, NATIVE, {}, CTX);
    expect(r.ok).toBe(false);
  });
  it.each(['short', 'has space in it', 'quote"inside1234', 'new\nline-1234567', 'x'.repeat(513), 'semi;colon12345', '$(whoami)12345'])('refuses %j and the message never repeats the value', (bad) => {
    const r = compileDagJob(parseOk(entry()), NATIVE, { bifrost_token: bad }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.errors)).not.toContain(bad.slice(0, 8) === 'short' ? 'short-never-matches' : bad);
  });
});

describe('the runner', () => {
  const SECRET = 'S3cretServiceToken-0123456789';
  const ENV = { NODE_ENV: 'test', JOBS_OWNER_HMAC_KEY: 'k'.repeat(40), DAGU_URL: 'http://dagu.test:8080', DAGU_TOKEN: SECRET, DAGU_ALLOWED_EXECUTORS: 'kubernetes,command,http,jq', JOBS_ALLOWED_IMAGE_PREFIXES: 'quay.io/cdis/', DAGU_K8S_NAMESPACE: 'dagu-jobs', DAGU_K8S_SERVICE_ACCOUNT: 'dagu-runner' };
  const alice = { user: 'alice@example.org', token: 'alice-bearer-token' };
  let fake: ReturnType<typeof createFakeDagu>;
  beforeEach(() => { fake = createFakeDagu({ authorization: `Bearer ${SECRET}` }); vi.stubGlobal('fetch', fake.fetch); });
  afterEach(() => vi.unstubAllGlobals());
  const spec = (secret_env?: Array<{ name: string; value: string }>, definition = NATIVE.text): LaunchSpec => ({
    name: 'Ask', steps: [], inputs: [], outputs: [], secrets: [], warnings: [],
    dag: { engine: 'dagu', definition, dag_name: 'ask', params: {}, ...(secret_env ? { secret_env } : {}) },
    tags: { 'vectis.job': 'ask', 'vectis.catalog_sha': 'a'.repeat(40), 'vectis.catalog_repo': 'org/jobs' },
  });
  const failure = async (p: Promise<unknown>): Promise<RunnerError> => {
    const e = await p.then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(RunnerError);
    return e as RunnerError;
  };

  it('puts the value in the pod environment only: not in the params, the labels or the command', async () => {
    await createDaguRunner(() => ENV).submit(spec([{ name: 'BIFROST_API_KEY', value: KEY }]), alice);
    const body = fake.calls[0].body as { spec: string; params: string; labels: string[]; name: string };
    const doc = parse(body.spec) as { kubernetes: { env: Array<{ name: string; value: string }> }; steps: unknown };
    expect(doc.kubernetes.env).toContainEqual({ name: 'BIFROST_API_KEY', value: KEY });
    expect(body.params).not.toContain(KEY);
    expect(JSON.parse(body.params)).toEqual({});
    expect(JSON.stringify(body.labels)).not.toContain(KEY);
    expect(JSON.stringify(doc.steps)).not.toContain(KEY);
    expect(body.name).not.toContain(KEY);
  });
  it('refuses a secret for a job that has no Kubernetes step, rather than dropping it', async () => {
    const e = await failure(createDaguRunner(() => ENV).submit(spec([{ name: 'BIFROST_API_KEY', value: KEY }], 'steps:\n  - id: s1\n    action: http.request\n    with:\n      method: GET\n      url: https://example.org/\n'), alice));
    expect(e.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });
  it.each([
    [[{ name: 'PATH', value: KEY }]],
    [[{ name: 'AWS_SESSION_TOKEN', value: KEY }]],
    [[{ name: 'BIFROST_API_KEY', value: 'has space in it' }]],
    [[{ name: 'BIFROST_API_KEY', value: KEY }, { name: 'BIFROST_API_KEY', value: KEY }]],
    [Array.from({ length: 5 }, (_v, i) => ({ name: `K${i}_API_KEY`, value: KEY }))],
  ])('refuses a secret list it was handed that is not valid (%#)', async (list) => {
    const e = await failure(createDaguRunner(() => ENV).submit(spec(list), alice));
    expect(e.status).toBe(400);
    expect(JSON.stringify(e.details ?? [])).not.toContain(KEY);
    expect(fake.calls).toHaveLength(0);
  });
  it('never overrides a variable the profile sets', () => {
    const profile = { name: 'notebook', service_account: 'job-notebook', user_token: false, env: [{ name: 'BIFROST_API_KEY', value: 'operator' }] };
    expect(() => kubernetesBlock(ENV, profile, 'alice', 'run1', [{ name: 'BIFROST_API_KEY', value: KEY }])).toThrow();
  });
  it('removes the value from an error the workflow server sends back', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/dag-runs') && !url.includes('/gate/')) return new Response(JSON.stringify({ message: `bad env value ${KEY} in definition` }), { status: 500, headers: { 'content-type': 'application/json' } });
      return fake.fetch(input as never);
    });
    const e = await failure(createDaguRunner(() => ENV).submit(spec([{ name: 'BIFROST_API_KEY', value: KEY }]), alice));
    expect(JSON.stringify([e.message, e.details ?? []])).not.toContain(KEY);
  });
});

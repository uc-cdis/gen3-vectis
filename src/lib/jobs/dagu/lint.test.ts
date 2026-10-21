/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { allowedExecutors, declaredParamNames, lintDaguDefinition } from './lint';
import { DAG_FANOUT, DAG_HELLO, DAG_SOC } from '../testing/definitions';

const DEV = { NODE_ENV: 'test' };
const ex = (f: 'hello.yaml' | 'fanout.yaml' | 'soc-enrich-indicator.yaml'): string => ({ 'hello.yaml': DAG_HELLO, 'fanout.yaml': DAG_FANOUT, 'soc-enrich-indicator.yaml': DAG_SOC })[f];
const errs = (text: string, env: Record<string, string | undefined> = DEV, catalogParams: string[] = []) => {
  const r = lintDaguDefinition(text, { env, catalogParams });
  return r.ok ? [] : r.errors;
};
const CMD = { ...DEV, DAGU_ALLOWED_EXECUTORS: 'command,http,jq' };
const one = (step: string, top = '') => `${top}steps:\n  - id: s1\n${step.split('\n').map((l) => `    ${l}`).join('\n')}\n`;

describe('allowed executors', () => {
  it('defaults to docker, http, mail, jq; command/shell/ssh only when listed', () => {
    expect([...allowedExecutors({})].sort()).toEqual(['docker', 'http', 'jq', 'mail']);
    expect([...allowedExecutors({ DAGU_ALLOWED_EXECUTORS: '  ' })].sort()).toEqual(['docker', 'http', 'jq', 'mail']);
    expect(allowedExecutors({ DAGU_ALLOWED_EXECUTORS: 'shell' }).has('command')).toBe(true); // alias
    expect(allowedExecutors({ DAGU_ALLOWED_EXECUTORS: 'Container, HTTP' })).toEqual(new Set(['docker', 'http']));
    expect(allowedExecutors({ DAGU_ALLOWED_EXECUTORS: 'a b;c,,x y' })).toEqual(new Set()); // junk is ignored, never widened
  });
});

describe('sample definitions', () => {
  it('soc-enrich-indicator passes with the DEFAULT executors (http + jq only)', () => {
    const r = lintDaguDefinition(ex('soc-enrich-indicator.yaml'), { env: DEV, catalogParams: ['indicator'] });
    expect(r).toMatchObject({ ok: true });
    expect(r.ok ? r.info.steps : null).toEqual([
      { name: 'enrich', depends_on: [], executor: 'http.request' },
      { name: 'shape', depends_on: ['enrich'], executor: 'jq.filter' },
      { name: 'notify', depends_on: ['shape'], executor: 'http.request' },
    ]);
  });
  it('hello and fanout need `command`, which is off by default', () => {
    expect(errs(ex('hello.yaml'))[0]).toMatch(/"command" executor is not enabled/);
    expect(errs(ex('fanout.yaml'), DEV, ['label'])[0]).toMatch(/"command" executor is not enabled/);
    expect(errs(ex('hello.yaml'), CMD)).toEqual([]);
    const f = lintDaguDefinition(ex('fanout.yaml'), { env: CMD, catalogParams: ['label'] });
    expect(f.ok && f.info.steps.find((s) => s.name === 'join')?.depends_on).toEqual(['branch_a', 'branch_b', 'branch_c']);
  });
  it('every catalog parameter must be declared natively', () => {
    expect(errs(ex('fanout.yaml'), CMD, ['label', 'nope'])[0]).toMatch(/"nope" is not declared/);
  });
});

describe('executor allowlist', () => {
  it('rejects every non-listed executor, whatever way it is spelled', () => {
    for (const step of ['run: echo hi', 'command: echo hi', 'script: echo hi', 'exec: echo hi']) expect(errs(one(step))[0], step).toMatch(/"command" executor is not enabled/);
    expect(errs(one('action: ssh.run\nwith:\n  host: example.org\n  user: u\n  command: id'))[0]).toMatch(/"ssh" executor is not enabled/);
    expect(errs(one('type: ssh\nconfig:\n  host: example.org'))[0]).toMatch(/"ssh" executor is not enabled/);
    expect(errs(one('action: file.write\nwith:\n  path: /tmp/x'))[0]).toMatch(/"file" executor is not enabled/);
    expect(errs(one('action: owner/repo@v1'))[0]).toMatch(/"remote" executor is not enabled/);
    expect(errs(one('action: my.custom.thing'))[0]).toMatch(/not enabled/);
  });
  it('a listed executor is accepted; aliases work; a shell step in a container is a docker step, not a host command', () => {
    expect(errs(one('run: echo hi'), { ...DEV, DAGU_ALLOWED_EXECUTORS: 'shell' })).toEqual([]);
    const env = { ...DEV, DAGU_ALLOWED_EXECUTORS: 'docker', JOBS_ALLOWED_IMAGE_PREFIXES: 'alpine' };
    expect(errs(one('run: echo hi\ncontainer:\n  image: alpine:3.20'), env)).toEqual([]);
    expect(errs(one('run: echo hi\ncontainer:\n  image: alpine:3.20'), { ...DEV, DAGU_ALLOWED_EXECUTORS: 'http', JOBS_ALLOWED_IMAGE_PREFIXES: 'alpine' })[0]).toMatch(/"docker" executor is not enabled/);
  });
  it('needs exactly one executor selector per step', () => {
    expect(errs(one('run: a\naction: http.request'), CMD)[0]).toMatch(/exactly one/);
    expect(errs(one('description: nothing runs'), CMD)[0]).toMatch(/exactly one/);
    expect(errs(one('run: a\ncommand: b'), CMD)[0]).toMatch(/only one of run/);
  });
});

describe('docker steps follow the shared image policy', () => {
  const env = (o: Record<string, string> = {}) => ({ ...DEV, DAGU_ALLOWED_EXECUTORS: 'docker', ...o });
  const docker = (image: string, extra = '') => one(`action: docker.run\nwith:\n  image: ${image}\n  command: echo hi${extra}`);
  it('uses JOBS_ALLOWED_IMAGE_PREFIXES, falling back to TES_ALLOWED_IMAGE_PREFIXES', () => {
    expect(errs(docker('registry.example.org/tools/x:1'), env({ JOBS_ALLOWED_IMAGE_PREFIXES: 'registry.example.org/tools/' }))).toEqual([]);
    expect(errs(docker('evil.io/x:1'), env({ JOBS_ALLOWED_IMAGE_PREFIXES: 'registry.example.org/tools/' }))[0]).toMatch(/image is not allowed/);
    expect(errs(docker('evil.io/x:1'), env({ TES_ALLOWED_IMAGE_PREFIXES: 'registry.example.org/tools/' }))[0]).toMatch(/image is not allowed/);
    expect(errs(docker('registry.example.org/tools/x:1'), env({ TES_ALLOWED_IMAGE_PREFIXES: 'registry.example.org/tools/' }))).toEqual([]);
  });
  it('production with nothing configured denies containers; digest pinning is honoured', () => {
    expect(errs(docker('alpine'), { NODE_ENV: 'production', DAGU_ALLOWED_EXECUTORS: 'docker' })[0]).toMatch(/not enabled on this deployment/);
    expect(errs(docker('alpine:3'), env({ JOBS_ALLOWED_IMAGE_PREFIXES: 'alpine', JOBS_REQUIRE_IMAGE_DIGEST: 'true' }))[0]).toMatch(/image is not allowed/);
  });
  it('the image must be a literal, and no volumes/network/privilege knobs exist', () => {
    expect(errs(docker('${params.img}'), env())[0]).toMatch(/literal image/);
    for (const k of ['volumes: [/:/host]', 'network: host', 'container_name: x', 'host: tcp://x', 'exec: true']) expect(errs(docker('alpine', `\n  ${k}`), env())[0], k).toMatch(/not allowed for the "docker" executor/);
    expect(errs(one('run: id\ncontainer: some-running-container'), { ...DEV, DAGU_ALLOWED_EXECUTORS: 'docker' })[0]).toMatch(/must be a mapping with an image/);
    expect(errs(one('run: id\ncontainer:\n  image: alpine\n  volumes: [/:/h]'), env())[0]).toMatch(/volumes: not allowed/);
  });
});

describe('deny by default', () => {
  const top = (extra: string) => `${extra}\nsteps:\n  - id: s1\n    run: echo hi\n`;
  it('refuses top-level keys that cause host side effects', () => {
    for (const k of ['schedule: "* * * * *"', 'webhook: {token: x}', 'dotenv: .env', 'working_dir: /', 'ssh: {host: x}', 'preconditions: [{condition: x}]', 'step_types: {}', 'actions: {}', 'handler_on: {failure: {run: id}}', 'log_dir: /tmp', 'tools: [x/y@1]', 'worker_selector: {a: b}', 'smtp: {host: x}', 'kubernetes: {}', 'harness: {}', 'queue: x', 'registry_auths: {}', 's3: {}', 'redis: {}']) {
      expect(errs(top(k), CMD)[0], k).toMatch(/not allowed in a portal-managed definition/);
    }
  });
  it('refuses step keys that read/write host files, call other DAGs or wait for humans', () => {
    for (const k of ['stdout: /tmp/x', 'stderr: /tmp/x', 'stdin: /etc/passwd', 'working_dir: /', 'call: other', 'parallel: {items: [a]}', 'preconditions: [x]', 'approval: {}', 'foreach: [a]', 'pass_env: [X]', 'worker_selector: {a: b}', 'repeat_policy: {}']) {
      expect(errs(one(`run: echo hi\n${k}`), CMD)[0], k).toMatch(/not allowed in a portal-managed definition/);
    }
  });
  it('only graph and chain types; steps must be a non-empty list of at most 64', () => {
    expect(errs('type: agent\nsteps:\n  - id: a\n    run: x\n', CMD)[0]).toMatch(/only graph or chain/);
    expect(errs('type: build\nsteps:\n  - id: a\n    run: x\n', CMD)[0]).toMatch(/only graph or chain/);
    expect(errs('name: x\n', CMD)[0]).toMatch(/non-empty list/);
    expect(errs(`steps:\n${Array.from({ length: 65 }, (_, i) => `  - id: s${i}\n    run: x\n`).join('')}`, CMD)[0]).toMatch(/at most 64/);
  });
  it('rejects `with` keys outside the per-executor allowlists (files, debug, tls skip, attachments, ...)', () => {
    for (const k of ['files: {f: /etc/passwd}', 'skip_tls_verify: true', 'debug: true', 'output: /tmp/o', 'form: {a: b}']) expect(errs(one(`action: http.request\nwith:\n  method: GET\n  url: https://intel.example.org/x\n  ${k}`))[0], k).toMatch(/not allowed for the "http" executor/);
    expect(errs(one('action: mail.send\nwith:\n  to: a@example.org\n  subject: s\n  message: m\n  attachments: [/etc/passwd]'))[0]).toMatch(/not allowed for the "mail" executor/);
  });
  it('rejects unknown params shapes only by the catalog check, accepts every documented form', () => {
    expect(declaredParamNames('A=1 B=2').sort()).toEqual(['A', 'B']);
    expect(declaredParamNames([{ A: 1 }, 'B=2', { name: 'C', default: 'x' }])).toEqual(['A', 'B', 'C']);
    expect(declaredParamNames({ type: 'object', properties: { X: { type: 'string' } } })).toEqual(['X']);
    expect(declaredParamNames({ A: 'x' })).toEqual(['A']);
  });
});

describe('gaps closed in review', () => {
  it('a legacy `type: docker` step is held to the image policy like docker.run', () => {
    const env = { ...DEV, DAGU_ALLOWED_EXECUTORS: 'docker', JOBS_ALLOWED_IMAGE_PREFIXES: 'registry.example.org/tools/' };
    expect(errs(one('type: docker\nconfig:\n  image: evil.io/x'), env)[0]).toMatch(/image is not allowed/);
    expect(errs(one('type: docker\nconfig:\n  image: registry.example.org/tools/x:1\n  command: echo'), env)).toEqual([]);
    expect(errs(one('type: docker\nconfig:\n  image: registry.example.org/tools/x:1\n  volumes: [/:/h]'), env)[0]).toMatch(/not allowed for the "docker" executor/);
  });
  it('`with` and `config` together are refused (one could hide what the other says)', () => {
    expect(errs(one('action: http.request\nwith: {method: GET, url: "https://intel.example.org/"}\nconfig: {files: {a: /etc/passwd}}'))[0]).toMatch(/not both/);
  });
  it('params may not use an external schema (file/url fetch) or `eval` (runs a command)', () => {
    expect(errs(`params:\n  schema: https://evil.example.org/s.json\nsteps:\n  - id: s\n    run: x\n`, CMD)[0]).toMatch(/external schema/);
    expect(errs(`params:\n  - name: a\n    default: x\n    eval: id\nsteps:\n  - id: s\n    run: x\n`, CMD)[0]).toMatch(/eval/);
  });
});

describe('graph', () => {
  it('rejects duplicate ids, unknown dependencies and cycles', () => {
    expect(errs('steps:\n  - id: a\n    run: x\n  - id: a\n    run: y\n', CMD)[0]).toMatch(/duplicate step id/);
    expect(errs('steps:\n  - id: a\n    run: x\n    depends: [zz]\n', CMD)[0]).toMatch(/unknown step "zz"/);
    expect(errs('steps:\n  - id: a\n    run: x\n    depends: [b]\n  - id: b\n    run: y\n    depends: [a]\n', CMD)[0]).toMatch(/cycle/);
    expect(errs('steps:\n  - id: a\n    run: x\n    depends: [a]\n', CMD)[0]).toMatch(/cycle/);
  });
  it('step ids are strict; id and name may not disagree', () => {
    expect(errs('steps:\n  - id: "a b"\n    run: x\n', CMD)[0]).toMatch(/needs an id/);
    expect(errs('steps:\n  - id: "../x"\n    run: x\n', CMD)[0]).toMatch(/needs an id/);
    expect(errs('steps:\n  - id: a\n    name: b\n    run: x\n', CMD)[0]).toMatch(/id OR a name/);
    expect(errs('steps:\n  - name: only_name\n    run: x\n', CMD)).toEqual([]);
  });
  it('chain: each step implicitly depends on the previous one', () => {
    const r = lintDaguDefinition('type: chain\nsteps:\n  - id: a\n    run: x\n  - id: b\n    run: y\n  - id: c\n    run: z\n', { env: CMD });
    expect(r.ok && r.info.steps.map((s) => s.depends_on)).toEqual([[], ['a'], ['b']]);
  });
});

describe('strict YAML and size', () => {
  it('rejects anchors, merge keys, multiple documents, control characters, duplicate keys, oversize', () => {
    expect(errs('x: &a 1\nsteps:\n  - id: s\n    run: x\n    env: {A: *a}\n', CMD).length).toBeGreaterThan(0);
    expect(errs('---\nsteps:\n  - id: s\n    run: x\n---\nname: other\n', CMD).length).toBeGreaterThan(0);
    expect(errs('steps:\n  - id: s\n    run: "a\u0007b"\n', CMD)[0]).toMatch(/control characters/);
    expect(errs('steps:\n  - id: s\n    id: t\n    run: x\n', CMD).length).toBeGreaterThan(0);
    expect(errs(`# ${'x'.repeat(70000)}\nsteps:\n  - id: s\n    run: x\n`, CMD)[0]).toMatch(/larger than 64KB/);
    expect(errs('- not\n- a mapping\n', CMD)[0]).toMatch(/YAML mapping/);
  });
});

describe('injection and side channels in values', () => {
  it('command substitution is refused everywhere except inside a shell step command', () => {
    expect(errs(one('run: echo "$(id)"'), CMD)).toEqual([]); // the author of a shell step wrote a shell command
    expect(errs('env:\n  X: "`id`"\nsteps:\n  - id: s\n    run: echo\n', CMD)[0]).toMatch(/command substitution/);
    expect(errs(one('run: echo\nenv:\n  X: $(id)'), CMD)[0]).toMatch(/command substitution/);
    expect(errs(one('action: http.request\nwith:\n  method: GET\n  url: https://intel.example.org/x\n  query:\n    a: "`id`"'), CMD)[0]).toMatch(/command substitution/);
    expect(errs(one('action: jq.filter\nwith:\n  filter: ".a"\n  data: "$(id)"'), CMD)[0]).toMatch(/command substitution/);
  });
  it('variables an operator must control cannot be overridden by a definition', () => {
    for (const k of ['PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'IFS', 'BASH_ENV', 'PYTHONPATH', 'DAGU_HOME', 'NODE_OPTIONS']) expect(errs(`env:\n  ${k}: x\nsteps:\n  - id: s\n    run: x\n`, CMD)[0], k).toMatch(/may not be set by a definition/);
  });
  it('the vectis.* labels belong to the portal', () => {
    for (const l of ['labels: ["vectis.owner=abc"]', 'labels:\n  vectis.submitted_by: bob', 'tags: "vectis.job=x"', 'labels: [{vectis.owner: x}]']) expect(errs(`${l}\nsteps:\n  - id: s\n    run: x\n`, CMD)[0], l).toMatch(/vectis\.\* labels belong to the portal/);
    expect(errs('labels: [team=soc]\nsteps:\n  - id: s\n    run: x\n', CMD)).toEqual([]);
  });
  it('a user parameter may not land in a mail recipient, image, file path, jq program or url host', () => {
    const p = (step: string, top = 'params:\n  - v: x\n') => errs(`${top}${one(step)}`, { ...CMD, DAGU_ALLOWED_EXECUTORS: 'command,http,jq,mail' }, ['v']);
    expect(p('action: mail.send\nwith:\n  to: ${params.v}\n  subject: s\n  message: m')[0]).toMatch(/may not choose a mail address|may not be used in this field/);
    expect(p('action: jq.filter\nwith:\n  filter: ".a == \\"${params.v}\\""\n  data: {a: 1}')[0]).toMatch(/jq program|may not be used/);
    expect(p('action: jq.filter\nwith:\n  input: ${params.v}\n  filter: .a')[0]).toMatch(/may not be used in this field/);
    expect(p('action: http.request\nwith:\n  method: GET\n  url: https://${params.v}/x')[0]).toMatch(/url host is not allowed|url must be https/);
    expect(p('action: http.request\nwith:\n  method: GET\n  url: ${params.v}')[0]).toMatch(/url must be https/);
    expect(p('action: http.request\nwith:\n  method: GET\n  url: ${v}')[0]).toMatch(/must be a name declared under secrets/);
    expect(p('run: cat ${params.v}\nenv: {A: b}')).toEqual([]); // shell text is where params belong (charset-guarded at compile)
    expect(p('action: http.request\nwith:\n  method: GET\n  url: https://intel.example.org/x\n  query: {q: "${params.v}"}')).toEqual([]);
    // a jq variable named like a declared param is (conservatively) read as a param reference, so the example uses distinct names
    expect(p('action: jq.filter\nwith:\n  filter: ".a == $needle"\n  data: {a: 1}\n  args: {needle: "${params.v}"}')).toEqual([]);
    expect(errs('params:\n  - v: x\nenv:\n  A: ${params.v}\nsteps:\n  - id: s\n    run: x\n', CMD, ['v'])[0]).toMatch(/may not be used in this field/);
  });
});

describe('http urls', () => {
  const http = (url: string, top = '') => errs(`${top}${one(`action: http.request\nwith:\n  method: GET\n  url: ${url}`)}`);
  it('accepts https on a public host, or exactly one operator variable from secrets:/env:', () => {
    expect(http('https://intel.example.org/api')).toEqual([]);
    const s = 'secrets:\n  - name: HOOK\n    provider: env\n    key: VECTIS_JOB_HOOK\n';
    expect(http('${HOOK}', s)).toEqual([]);
    expect(http('${secrets.HOOK}', s)).toEqual([]);
    expect(http('${env.HOOK}', s).length).toBeGreaterThan(0); // env is not a url source (see lint.security.test.ts)
  });
  it('refuses http, internal hosts, IPs, undeclared variables, and credentials in the url', () => {
    for (const u of ['http://intel.example.org/', 'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://service.internal/x', 'https://svc.cluster.local/x', 'https://u:p@intel.example.org/', 'ftp://x.example.org/', 'file:///etc/passwd', '${NOT_DECLARED}']) {
      expect(http(u).length, u).toBeGreaterThan(0);
    }
  });
  it('honours TES_ALLOWED_URL_HOSTS', () => {
    const r = lintDaguDefinition(one('action: http.request\nwith:\n  method: GET\n  url: https://intel.example.org/x'), { env: { ...DEV, TES_ALLOWED_URL_HOSTS: 'other.example.com' } });
    expect(r.ok).toBe(false);
  });
});

describe('credentials', () => {
  const T = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  it('refuses the shared credential patterns anywhere in the file', () => {
    expect(errs(one(`run: echo ${T}`), CMD)[0]).toMatch(/AWS access key/);
    expect(errs(`# ${T}\nsteps:\n  - id: s\n    run: x\n`, CMD)).toEqual([]); // comments are not data
    expect(errs(one('run: x\nenv: {A: "-----BEGIN RSA PRIVATE KEY-----"}'), CMD)[0]).toMatch(/PEM private key/);
  });
  it('a field named like a secret must hold a ${reference}, never a literal', () => {
    expect(errs(one('action: http.request\nwith:\n  method: GET\n  url: https://intel.example.org/x\n  headers:\n    Authorization: Bearer abc123'))[0]).toMatch(/credential field with a literal value/);
    expect(errs(one('action: http.request\nwith:\n  method: GET\n  url: https://intel.example.org/x\n  headers:\n    Authorization: Bearer ${env.XTOK}', 'env:\n  XTOK: x\n'), DEV)).toEqual([]);
    expect(errs('env:\n  API_TOKEN: literal\nsteps:\n  - id: s\n    run: x\n', CMD)[0]).toMatch(/credential field with a literal value/);
    expect(errs('env:\n  X: y\n  DB_PASSWORD: "${env.X}"\nsteps:\n  - id: s\n    run: x\n', CMD)).toEqual([]);
  });
  it('secrets: only the env provider, plain names, no options, nothing named DAGU_*', () => {
    const s = (body: string) => errs(`secrets:\n${body}steps:\n  - id: s\n    run: x\n`, CMD);
    expect(s('  - name: A\n    provider: env\n    key: VECTIS_JOB_A\n')).toEqual([]);
    expect(s('  - name: A\n    provider: vault\n    key: a/b\n')[0]).toMatch(/provider: only env/);
    expect(s('  - name: A\n    provider: file\n    key: /etc/shadow\n')[0]).toMatch(/provider: only env/);
    expect(s('  - name: A\n    provider: env\n    key: VECTIS_JOB_A\n    options: {token: x}\n')[0]).toMatch(/not allowed \(only name, provider, key\)/);
    expect(s('  - name: DAGU_AUTH_TOKEN_SECRET\n    provider: env\n    key: A\n')[0]).toMatch(/not DAGU_/);
    expect(s('  - ref: team/secret\n    name: A\n')[0]).toMatch(/not allowed/);
  });
});

describe('Kubernetes steps (k8s.run)', () => {
  const K8S = { ...DEV, DAGU_ALLOWED_EXECUTORS: 'kubernetes,http,jq' };
  const k8sStep = (withBlock: string) => one(`action: k8s.run\nwith:\n${withBlock.split('\n').map((l) => `  ${l}`).join('\n')}`);
  it('is off unless the operator lists kubernetes, and the default list still has no kubernetes', () => {
    expect(allowedExecutors({}).has('kubernetes')).toBe(false);
    expect(errs(k8sStep('image: quay.io/cdis/tool:1\ncommand: echo hi'), DEV)[0]).toMatch(/"kubernetes" executor is not enabled/);
    expect(errs(k8sStep('image: quay.io/cdis/tool:1\ncommand: echo hi'), K8S)).toEqual([]);
  });
  it('reports the step as a Kubernetes step, so the runner adds the namespace and service account', () => {
    const r = lintDaguDefinition(k8sStep('image: quay.io/cdis/tool:1\ncommand: echo hi'), { env: K8S, catalogParams: [] });
    expect(r.ok && r.info.usesKubernetes).toBe(true);
    const h = lintDaguDefinition(ex('soc-enrich-indicator.yaml'), { env: K8S, catalogParams: ['indicator'] });
    expect(h.ok && h.info.usesKubernetes).toBe(false);
  });
  it('allows only image and command: no context, no resources, no service account, no namespace', () => {
    for (const k of ['context: other-cluster', 'resources: {limits: {cpu: "64"}}', 'service_account: admin', 'namespace: kube-system', 'privileged: true']) {
      expect(errs(k8sStep(`image: quay.io/cdis/tool:1\ncommand: echo hi\n${k}`), K8S).join(' '), k).toMatch(/not allowed for the "kubernetes" executor/);
    }
  });
  it('refuses a top-level kubernetes block: a definition cannot choose where it runs', () => {
    expect(errs(k8sStep('image: quay.io/cdis/tool:1\ncommand: echo hi'), K8S).length).toBe(0);
    expect(errs(`kubernetes:\n  namespace: kube-system\n  service_account: admin\n${k8sStep('image: quay.io/cdis/tool:1\ncommand: echo hi')}`, K8S).join(' ')).toMatch(/kubernetes/);
  });
  it('applies the shared image policy', () => {
    const policy = { ...K8S, JOBS_ALLOWED_IMAGE_PREFIXES: 'quay.io/cdis/' };
    expect(errs(k8sStep('image: quay.io/cdis/tool:1\ncommand: echo hi'), policy)).toEqual([]);
    expect(errs(k8sStep('image: evil.example/tool:1\ncommand: echo hi'), policy).join(' ')).toMatch(/image/);
  });
});

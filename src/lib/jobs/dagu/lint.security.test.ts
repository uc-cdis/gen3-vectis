/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { lintDaguDefinition } from './lint';
import { parseYamlStrict } from '../jobdef/yamlStrict';

/** Security regressions for the Dagu lint: each test pins a case that was once accepted and must stay refused. */
const DEV: Record<string, string | undefined> = { NODE_ENV: 'test', DAGU_ALLOWED_EXECUTORS: 'command,http,jq,docker,mail', JOBS_ALLOWED_IMAGE_PREFIXES: 'alpine' };
const errs = (text: string, env: Record<string, string | undefined> = DEV, catalogParams: string[] = []) => { const r = lintDaguDefinition(text, { env, catalogParams }); return r.ok ? [] : r.errors; };
const one = (step: string, top = '') => `${top}steps:\n  - id: s1\n${step.split('\n').map((l) => `    ${l}`).join('\n')}\n`;
const P = 'params:\n  - p: x\n';
const SECRET = 'secrets:\n  - name: HOOK\n    provider: env\n    key: VECTIS_JOB_HOOK\n';
const httpUrl = (url: string, top = P) => errs(one(`action: http.request\nwith:\n  method: GET\n  url: ${url}`, top), DEV, ['p']);

describe('a parameter cannot change the host a url contacts', () => {
  it('refuses a parameter (or anything but / ? #) right after the host', () => {
    for (const u of ['https://good.example.org${params.p}', 'https://good.example.org$p', 'https://good.example.org${p}', 'https://good.example.org.${params.p}', 'https://good.example.org:${params.p}', 'https://good.example.org@${params.p}', 'https://good.example.org\\${params.p}', 'https://good.example.org;x']) {
      expect(httpUrl(u).length, u).toBeGreaterThan(0);
    }
  });
  it('allows a parameter inside the path, query or fragment after the pinned host', () => {
    for (const u of ['https://good.example.org/${params.p}', 'https://good.example.org/a/${params.p}/b', 'https://good.example.org/?q=${params.p}', 'https://good.example.org#${params.p}', 'https://good.example.org/x?a=${p}']) expect(httpUrl(u), u).toEqual([]);
  });
  it('refuses .. segments, in the template (and the template with parameters replaced still has to be a valid public https url)', () => {
    expect(httpUrl('https://good.example.org/a/../b')[0]).toMatch(/\.\./);
    expect(httpUrl('https://good.example.org/${params.p}/..')[0]).toMatch(/\.\./);
    expect(httpUrl('https://127.0.0.1/${params.p}').length).toBeGreaterThan(0);
  });
});

describe('a whole-variable url may only come from a declared secrets: name', () => {
  it('accepts a declared secret and nothing else', () => {
    expect(httpUrl('${HOOK}', SECRET + P)).toEqual([]);
    expect(httpUrl('${secrets.HOOK}', SECRET + P)).toEqual([]);
  });
  it('refuses a literal env/consts value as a url source', () => {
    expect(httpUrl('${U}', 'env:\n  U: http://169.254.169.254/latest\n' + P)[0]).toMatch(/secrets:/);
    expect(httpUrl('${env.U}', 'env:\n  U: https://good.example.org/\n' + P)[0]).toMatch(/url must be https|secrets:/);
    expect(httpUrl('${consts.U}', 'consts:\n  - U: http://x\n' + P).length).toBeGreaterThan(0);
  });
  it('refuses a step output (remotely controlled) or a user parameter as the url, or inside it', () => {
    const two = `${P}steps:\n  - id: a\n    action: http.request\n    with: {method: GET, url: "https://good.example.org/"}\n    output: SUMMARY\n  - id: b\n    depends: [a]\n    action: http.request\n    with:\n      method: GET\n      url: URL_HERE\n`;
    for (const u of ['${SUMMARY}', '${a.stdout}', 'https://good.example.org/${SUMMARY}', 'https://good.example.org/${a.output.x}', 'https://good.example.org/${steps.a.outputs.x}']) {
      expect(errs(two.replace('URL_HERE', `"${u}"`), DEV, ['p']).length, u).toBeGreaterThan(0);
    }
  });
});

describe('the Dagu server environment cannot be read', () => {
  it('a secret key must be on the operator allowlist: default prefix VECTIS_JOB_', () => {
    const s = (key: string, env = DEV) => errs(`secrets:\n  - name: X\n    provider: env\n    key: ${key}\n${one('run: echo hi')}`.replace('steps:\n  - id: s1', 'steps:\n  - id: s1'), env);
    expect(s('VECTIS_JOB_HOOK')).toEqual([]);
    for (const k of ['DAGU_AUTH_BASIC_PASSWORD', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'JOBS_OWNER_HMAC_KEY', 'TES_CATALOG_GITHUB_TOKEN', 'NODE_OPTIONS', 'PATH', 'HOME', 'SOC_WEBHOOK_URL']) expect(s(k)[0], k).toMatch(/not on the allowlist|never allowed/);
    // an operator list replaces the default prefix, but can never re-allow the denied families
    expect(s('MY_HOOK', { ...DEV, DAGU_ALLOWED_SECRET_KEYS: 'MY_HOOK,TEAM_*' })).toEqual([]);
    expect(s('TEAM_X', { ...DEV, DAGU_ALLOWED_SECRET_KEYS: 'MY_HOOK,TEAM_*' })).toEqual([]);
    expect(s('VECTIS_JOB_X', { ...DEV, DAGU_ALLOWED_SECRET_KEYS: 'MY_HOOK' })[0]).toMatch(/not on the allowlist/);
    expect(s('AWS_SECRET_ACCESS_KEY', { ...DEV, DAGU_ALLOWED_SECRET_KEYS: 'AWS_*,DAGU_*,PATH' })[0]).toMatch(/never allowed/);
  });
  it('every ${NAME} / $NAME outside shell text must be declared (params, env, consts, secrets, step outputs) or a verified Dagu variable', () => {
    const body = (b: string) => errs(one(`action: http.request\nwith:\n  method: POST\n  url: https://good.example.org/x\n  body: "${b}"`), DEV);
    for (const b of ['${AWS_SECRET_ACCESS_KEY}', '$AWS_SECRET_ACCESS_KEY', '${DAGU_AUTH_BASIC_PASSWORD}', '${env.AWS_SECRET_ACCESS_KEY}', '${secrets.NOPE}', '${HOME}', '${1}', '${A:-x}']) expect(body(b)[0], b).toMatch(/undeclared|not declared|unsupported/);
    expect(errs(one('action: http.request\nwith:\n  method: POST\n  url: https://good.example.org/x\n  body: "${context.run.id} ${DAG_RUN_WORK_DIR} ${env.A} ${CONSTV} ${HOOK} ${s1.stdout}"', 'env:\n  A: x\nconsts:\n  - CONSTV: y\n' + SECRET), DEV)).toEqual([]);
    expect(errs(`env:\n  A: x\nsteps:\n  - id: a\n    run: echo\n    output: OUT\n  - id: b\n    depends: [a]\n    action: jq.filter\n    with: {filter: ".", data: "\${OUT}"}\n`, DEV)).toEqual([]);
  });
  it('a jq program cannot read the environment', () => {
    for (const f of ['$ENV.AWS_SECRET_ACCESS_KEY', 'env', 'env.HOME', '[., $ENV]']) expect(errs(one(`action: jq.filter\nwith:\n  filter: '${f}'\n  data: {a: 1}`))[0], f).toMatch(/environment/);
    expect(errs(one('action: jq.filter\nwith:\n  filter: ".a"\n  data: {a: 1}'))).toEqual([]);
  });
});

describe('depth limits are errors, not silent truncation', () => {
  const nest = (n: number, leaf: string) => `${'['.repeat(0)}${Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}k${i}:`).join('\n')}\n${'  '.repeat(n)}${leaf}`;
  it('a credential at depth 15 (past the old scan limit of 12) is still found', () => {
    const doc = `env:\n  A:\n${nest(14, 'AKIAABCDEFGHIJKLMNOP').split('\n').map((l) => `    ${l}`).join('\n')}\nsteps:\n  - id: s\n    run: x\n`;
    expect(errs(doc).join(' ')).toMatch(/AWS access key|must be a plain value/);
  });
  it('block nesting beyond 20 levels, absurd indentation, or an enormous number of nodes is refused', () => {
    expect(parseYamlStrict(nest(25, '1')).ok).toBe(false);
    expect(parseYamlStrict(`a:\n${' '.repeat(300)}b: 1\n`).ok).toBe(false);
    expect(parseYamlStrict(`a: [${Array.from({ length: 25000 }, () => '1').join(',')}]\n`).ok).toBe(false);
    expect(parseYamlStrict(nest(10, '1')).ok).toBe(true);
  });
});

describe('labels must be ASCII and cannot spell vectis.* by Unicode tricks', () => {
  const l = (labels: string) => errs(`${labels}\n${one('run: x')}`);
  it('refuses non-ASCII, fullwidth, dotted-I and other spellings', () => {
    for (const x of ['labels: ["vectİs.owner=x"]', 'labels: ["ｖｅｃｔｉｓ.owner=x"]', 'labels: ["vectis。owner=x"]', 'labels: ["team=ü"]', 'labels: ["a b=c"]', 'labels: "a=b c=d"', 'labels: ["vectis.owner=x"]', 'labels: ["VECTIS.owner=x"]', 'labels: {"vectis.job": x}', 'tags: ["vecti\\u0073.owner=x"]', 'labels: ["a=b,c"]', 'labels: ["="]', 'labels: [{team: "é"}]']) expect(l(x).length, x).toBeGreaterThan(0);
  });
  it('accepts ordinary labels in list and map form', () => {
    expect(l('labels: [team=soc, tier-1, "env=prod/eu"]')).toEqual([]);
    expect(l('labels:\n  team: soc\n  n: 3')).toEqual([]);
    expect(l('tags: [soc]')).toEqual([]);
  });
});

describe('characters that parsers disagree on are refused, and Dagu gets the linted document', () => {
  it('refuses NEL, LS, PS, BOM, bidi, zero-width, soft hyphen and C1 controls in the definition text', () => {
    for (const c of ['\u0085', '\u2028', '\u2029', '\uFEFF', '\u202e', '\u2066', '\u200b', '\u200d', '\u2060', '\u00ad', '\u0090']) {
      expect(errs(`# note ${c}\n${one('run: x')}`)[0], JSON.stringify(c)).toMatch(/control characters/);
      expect(errs(one(`run: "echo a${c}b"`))[0], JSON.stringify(c)).toMatch(/control characters/);
    }
  });
  it('the linter returns the parsed document it checked (what is sent is re-serialised from it)', () => {
    const r = lintDaguDefinition('# c\nname: n\nsteps:\n  - id: a\n    run: echo "x"\n', { env: DEV });
    expect(r.ok && r.info.doc).toEqual(parse('name: n\nsteps:\n  - id: a\n    run: echo "x"\n'));
  });
});

describe('smaller hardening items', () => {
  it('image references follow the Docker grammar (no .., no odd characters, lower-case path)', () => {
    const img = (i: string) => errs(one(`action: docker.run\nwith:\n  image: ${i}\n  command: echo`), { ...DEV, JOBS_ALLOWED_IMAGE_PREFIXES: 'alpine,quay.io/' });
    expect(img('alpine:3.20')).toEqual([]);
    for (const i of ['alpine/../x', 'quay.io/../x', 'alpine:../x', 'quay.io//x', 'Quay.io/UPPER', 'quay.io/a..b/c', 'alpine@sha256:abc', '-alpine', 'quay.io/x:']) expect(img(i).length, i).toBeGreaterThan(0);
  });
  it('a parameter cannot be the first word of a shell command, or an http header NAME', () => {
    for (const run of ['${params.p}', '  ${params.p} --x', 'echo hi; ${params.p}', 'echo hi\n$p', 'a && ${p}']) expect(errs(one(`run: "${run.replace(/\n/g, '\\n')}"`, P), DEV, ['p'])[0], run).toMatch(/program|first word/);
    expect(errs(one('run: echo ${params.p}', P), DEV, ['p'])).toEqual([]);
    expect(errs(one('action: http.request\nwith:\n  method: GET\n  url: https://good.example.org/\n  headers:\n    "${params.p}": v', P), DEV, ['p'])[0]).toMatch(/header name/);
  });
  it('a step output: name must pass the environment-name deny list', () => {
    for (const n of ['PATH', 'LD_PRELOAD', 'DYLD_X', 'BASH_ENV', 'DAGU_HOME', 'NODE_OPTIONS', 'bad-name', '1X']) expect(errs(one(`run: echo\noutput: ${n}`))[0], n).toMatch(/output/);
    expect(errs(one('run: echo\noutput: RESULT'))).toEqual([]);
  });
  it('shell/shell_args only on a command step, only sh or bash, only known flags', () => {
    expect(errs(one('run: echo\nshell: bash'))).toEqual([]);
    expect(errs(one('run: echo\nshell: /bin/sh\nshell_args: [-e]'))).toEqual([]);
    for (const x of ['shell: python3', 'shell: /tmp/x', 'shell: "bash -c"', 'shell: [bash]', 'shell: bash\nshell_args: ["-c", "id"]', 'shell: bash\nshell_args: -c id', 'shell_args: [-e]\nshell: "/bin/bash;id"']) expect(errs(one(`run: echo\n${x}`))[0], x).toMatch(/shell/);
    expect(errs(one('action: http.request\nshell: bash\nwith: {method: GET, url: "https://good.example.org/"}'))[0]).toMatch(/shell/);
    expect(errs(one('run: echo\nshell: bash'), { ...DEV, DAGU_ALLOWED_EXECUTORS: 'http' })[0]).toMatch(/not enabled/);
  });
});

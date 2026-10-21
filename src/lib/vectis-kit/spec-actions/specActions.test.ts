import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FilterClause, QuerySpec } from '../spec';
import { toDrsManifest, isDrsUri } from './drs';
import { pythonLiteral, quoted, toCurl, toGraphql, toPython } from './snippets';
import { NOTEBOOK_PATH, NOTEBOOK_SPEC_STORAGE_KEY, buildNotebookPayload, openInNotebook } from './notebook';
import { SpecError, cleanSpec } from './validate';

const WINDOW = { start: '2026-10-08T18:00:00Z', end: '2026-10-09T18:00:00Z' };
const dir = mkdtempSync(path.join(tmpdir(), 'spec-actions-'));
const MARKER = path.join(dir, 'pwned');

/** Text built to break out of every kind of string literal. */
const HOSTILE = [
  `"; import os; os.system("touch ${MARKER}"); x="`,
  `'; touch ${MARKER}; echo '`,
  `$(touch ${MARKER})`,
  '`touch ' + MARKER + '`',
  '${VECTIS_TOKEN}',
  'line1\nline2\r\nline3',
  'back\\slash\\"quote\\',
  '"""triple""" \'\'\'single\'\'\'',
  'VECTIS_SPEC_JSON',
  '\u2028\u2029\u0000\u001b[31m',
  '</script><img src=x onerror=alert(1)>',
  '{{7*7}} %s {0} f"{x}"',
];

const specWith = (filters: FilterClause[], extra: Partial<QuerySpec> = {}): QuerySpec => ({
  index_name: 'http_activity', window: WINDOW, columns: ['event_time', 'src_ip', 'uri_path'], filters, sort: { field: 'event_time', dir: 'desc' }, ...extra,
});
const hostileSpec = specWith([
  ...HOSTILE.map((value, i): FilterClause => ({ field: 'uri_path', op: i % 2 ? 'contains' : 'eq', value })),
  { field: 'country', op: 'in', value: HOSTILE.slice(0, 8) } as FilterClause,
].slice(0, 20));

describe('escape', () => {
  it('quoted never contains a raw newline, quote break-out or separator', () => {
    for (const h of HOSTILE) {
      const q = quoted(h);
      expect(q.startsWith('"') && q.endsWith('"')).toBe(true);
      // eslint-disable-next-line no-control-regex
      expect(q).not.toMatch(/[\n\r\u2028\u2029\u0000]/);
      expect(JSON.parse(q.replace(/\\u(2028|2029|007f|0085)/g, (_, h2) => String.fromCharCode(parseInt(h2, 16))))).toBe(h);
    }
  });
  it('pythonLiteral uses Python spellings and refuses non-finite numbers', () => {
    expect(pythonLiteral({ a: [true, false, null, 1.5] })).toBe('{\n    "a": [\n        True,\n        False,\n        None,\n        1.5,\n    ],\n}');
    expect(() => pythonLiteral(Infinity)).toThrow('finite');
  });
});

describe('validate', () => {
  it('rejects bad index, window, columns, sort and too many filters', () => {
    expect(() => cleanSpec(specWith([], { index_name: 'x; drop' as never }))).toThrow(SpecError);
    expect(() => cleanSpec(specWith([], { window: { start: 'yesterday', end: WINDOW.end } }))).toThrow(SpecError);
    expect(() => cleanSpec(specWith([], { columns: ['ok', 'bad name'] }))).toThrow(SpecError);
    expect(() => cleanSpec(specWith([], { sort: { field: 'a b', dir: 'asc' } }))).toThrow(SpecError);
    const many = Array.from({ length: 21 }, (_, i): FilterClause => ({ field: 'country', op: 'eq', value: String(i) }));
    expect(() => cleanSpec(specWith(many))).toThrow(/Too many filters/);
  });
  it('drops unknown properties so they cannot reach generated code', () => {
    const evil = { ...specWith([]), seed: { type: 'ip', value: 'x' }, __extra: '"; rm -rf /' } as unknown as QuerySpec;
    expect(JSON.stringify(cleanSpec(evil))).not.toContain('rm -rf');
  });
});

const py = spawnSync('python3', ['--version']).status === 0;
describe.skipIf(!py)('toPython (executed against stub modules)', () => {
  const HARNESS = `
import sys, types, json
calls = []
gen3 = types.ModuleType("gen3"); gen3_auth = types.ModuleType("gen3.auth")
class Gen3Auth:
    def __init__(self, endpoint=None):
        self.endpoint = endpoint
gen3_auth.Gen3Auth = Gen3Auth
requests = types.ModuleType("requests")
class R:
    def raise_for_status(self): pass
    def json(self): return {"data": {"http_activity": []}}
def post(url, json=None, auth=None, headers=None, timeout=None):
    calls.append({"url": url, "json": json, "has_auth": auth is not None, "auth_endpoint": getattr(auth, "endpoint", None), "headers": headers})
    return R()
requests.post = post
pandas = types.ModuleType("pandas")
class DF:
    def __init__(self, rows): self.rows = rows; self.columns = list(rows[0].keys()) if rows else []
    def __getitem__(self, cols): return DF([{c: r[c] for c in cols} for r in self.rows])
    def sort_values(self, field, ascending=True): return self
    def reset_index(self, drop=False): return self
    def head(self): return None
pandas.DataFrame = DF
sys.modules.update({"gen3": gen3, "gen3.auth": gen3_auth, "requests": requests, "pandas": pandas})
src = open(sys.argv[1]).read()
exec(compile(src, sys.argv[1], "exec"), {})
print(json.dumps(calls))
`;
  const run = (code: string, env: Record<string, string> = {}) => {
    const file = path.join(dir, `snippet-${Math.random().toString(16).slice(2)}.py`);
    writeFileSync(file, code);
    const clean = { ...process.env } as Record<string, string | undefined>;
    delete clean.VECTIS_TOKEN;
    const r = spawnSync('python3', ['-c', HARNESS, file], { encoding: 'utf8', env: { ...clean, ...env } as NodeJS.ProcessEnv });
    return { ...r, calls: r.status === 0 ? (JSON.parse(r.stdout.split('\n').filter((l) => l.startsWith('[')).pop()!) as { url: string; json: unknown; has_auth: boolean; auth_endpoint: string | null; headers: Record<string, string> }[]) : [] };
  };
  const ENDPOINT = 'https://commons.example';

  const TF = 'event_time';
  const py_ = (spec: QuerySpec, extra: object = {}) => toPython(spec, { endpoint: ENDPOINT, timeField: TF, ...extra });
  const guppyFilter = (spec: QuerySpec) => (JSON.parse(toGraphql(spec, TF).variables) as { filter: unknown }).filter;

  it('is valid Python that posts the spec as a GraphQL query to the gateway, hostile values intact, nothing executed', () => {
    const r = run(py_(hostileSpec));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe('https://commons.example/guppy/graphql');
    const sent = r.calls[0]!.json as { query: string; variables: { filter: unknown } };
    expect(sent.variables.filter).toEqual(guppyFilter(hostileSpec));
    // the service reads first and offset from the query text
    expect(sent.query).toMatch(/http_activity\(filter: \$filter, first: 1000, offset: 0\)/);
    for (const h of HOSTILE) expect(sent.query).not.toContain(h);
    expect(existsSync(MARKER)).toBe(false);
  });
  it('writes the time window and every operator in the format the service compiles', () => {
    const spec = specWith([
      { field: 'src_ip', op: 'eq', value: '192.0.2.1' }, { field: 'rule_action', op: 'neq', value: 'ALLOW' },
      { field: 'country', op: 'in', value: ['US', 'DE'] }, { field: 'uri_path', op: 'contains', value: 'wp-login' },
    ]);
    const filter = guppyFilter(spec) as { AND: Record<string, unknown>[] };
    expect(filter.AND).toEqual([
      { '>=': { event_time: WINDOW.start } }, { '<=': { event_time: WINDOW.end } },
      { '=': { src_ip: '192.0.2.1' } }, { '!=': { rule_action: 'ALLOW' } }, { IN: { country: ['US', 'DE'] } },
      { search: { uri_path: 'wp-login' } },   // the service reads {field: text}; the other shape returns nothing
    ]);
  });
  it('in a workspace (no token) authenticates with Gen3Auth for that endpoint', () => {
    const r = run(py_(specWith([])));
    expect(r.status).toBe(0);
    expect(r.calls[0]!.has_auth).toBe(true);
    expect(r.calls[0]!.auth_endpoint).toBe(ENDPOINT);
    expect(r.calls[0]!.headers).toEqual({});
  });
  it('with VECTIS_TOKEN set sends it as a bearer token and does not need gen3 at all', () => {
    // Make the gen3 import fail; the token path must not touch it.
    const code = py_(specWith([])).replace('from gen3.auth import Gen3Auth', 'raise ImportError("gen3 is not installed")');
    const r = run(code, { VECTIS_TOKEN: 'tok-123' });
    expect(r.status).toBe(0);
    expect(r.calls[0]!.has_auth).toBe(false);
    expect(r.calls[0]!.headers).toEqual({ Authorization: 'Bearer tok-123' });
  });
  it('embeds no credential', () => {
    const code = py_(specWith([]));
    expect(code).toContain('Gen3Auth(endpoint=ENDPOINT)');
    expect(code).toContain('os.environ.get("VECTIS_TOKEN")');
    expect(code).not.toMatch(/api_key|password|eyJ|AKIA/i);
  });
  it('rejects an unsafe API path, commons URL or time field', () => {
    expect(() => py_(specWith([]), { apiPath: '/x"; import os' })).toThrow('API path');
    expect(() => py_(specWith([]), { endpoint: 'https://a.example"; import os #' })).toThrow('commons URL');
    expect(() => py_(specWith([]), { endpoint: 'ftp://a.example' })).toThrow('commons URL');
    expect(() => py_(specWith([]), { timeField: 'bad field' })).toThrow(SpecError);
  });
});

const pandasOk = spawnSync('python3', ['-c', 'import pandas']).status === 0;
describe.skipIf(!pandasOk)('toPython with real pandas and a stub gateway', () => {
  // The service returns every column in its own order, ignores sort, and answers a filter it cannot compile with an empty result.
  const HARNESS = `
import sys, types, json
calls = []
pages = json.loads(sys.argv[2])
gen3 = types.ModuleType("gen3"); gen3_auth = types.ModuleType("gen3.auth")
class Gen3Auth:
    def __init__(self, endpoint=None): self.endpoint = endpoint
gen3_auth.Gen3Auth = Gen3Auth
requests = types.ModuleType("requests")
class R:
    def __init__(self, payload): self.payload = payload
    def raise_for_status(self): pass
    def json(self): return self.payload
def post(url, json=None, auth=None, headers=None, timeout=None):
    calls.append(json["query"])
    return R(pages[min(len(calls) - 1, len(pages) - 1)])
requests.post = post
sys.modules.update({"gen3": gen3, "gen3.auth": gen3_auth, "requests": requests})
g = {}
exec(compile(open(sys.argv[1]).read(), sys.argv[1], "exec"), g)
print(json.dumps({"calls": calls, "records": g["df"].to_dict(orient="records"), "cols": list(g["df"].columns)}))
`;
  const exec_ = (code: string, pages: unknown[]) => {
    const file = path.join(dir, `pd-${Math.random().toString(16).slice(2)}.py`);
    writeFileSync(file, code);
    const r = spawnSync('python3', ['-c', HARNESS, file, JSON.stringify(pages)], { encoding: 'utf8' });
    return { ...r, out: r.status === 0 ? (JSON.parse(r.stdout.split('\n').filter((l) => l.startsWith('{')).pop()!) as { calls: string[]; records: Record<string, unknown>[]; cols: string[] }) : null };
  };
  const row = (i: number, extra: object = {}) => ({ event_time: `2026-10-08T00:00:0${i}Z`, src_ip: `192.0.2.${i}`, uri_path: `/p${i}`, unrelated_col: 'x', ...extra });
  const code = (extra: object = {}) => toPython(specWith([]), { endpoint: 'https://commons.example', timeField: 'event_time', pageSize: 5, ...extra });

  it('keeps only the chosen columns, in the chosen order, and sorts newest first itself', () => {
    const r = exec_(code(), [{ data: { http_activity: [row(1), row(3)] } }]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.out!.cols).toEqual(['event_time', 'src_ip', 'uri_path']);
    expect(r.out!.records.map((x) => x.src_ip)).toEqual(['192.0.2.3', '192.0.2.1']);
  });
  it('pages by offset in the query text until a short page', () => {
    const r = exec_(code({ pageSize: 2 }), [{ data: { http_activity: [row(1), row(2)] } }, { data: { http_activity: [row(3)] } }]);
    expect(r.out!.calls).toHaveLength(2);
    expect(r.out!.calls[0]).toContain('first: 2, offset: 0');
    expect(r.out!.calls[1]).toContain('first: 2, offset: 2');
    expect(r.out!.records).toHaveLength(3);
  });
  it('raises on a GraphQL error instead of returning an empty frame', () => {
    const r = exec_(code(), [{ data: null, errors: [{ message: 'boom' }] }]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('boom');
  });
  it('says so when nothing comes back, and when a chosen column is not returned', () => {
    const empty = exec_(code(), [{ data: { http_activity: [] } }]);
    expect(empty.status, empty.stderr).toBe(0);
    expect(empty.stdout).toMatch(/No rows came back/);
    const narrow = exec_(code(), [{ data: { http_activity: [{ event_time: '2026-10-08T00:00:01Z', src_ip: '192.0.2.1' }] } }]);
    expect(narrow.stdout).toMatch(/Columns the service did not return: \['uri_path'\]/);
  });
});

describe.skipIf(!py)('toPython for All events (executed against stub modules)', () => {
  const ENDPOINT_ = 'https://commons.example';
  const all = (filters: FilterClause[] = [], extra: Partial<QuerySpec> = {}) =>
    specWith(filters, { index_name: 'all_events', columns: ['event_time', 'index_name', 'src_ip', 'outcome'], ...extra });
  const py_ = (spec: QuerySpec) => toPython(spec, { endpoint: ENDPOINT_, timeField: 'event_time' });
  const HARNESS_ = `
import sys, types, json
calls = []
gen3 = types.ModuleType("gen3"); gen3_auth = types.ModuleType("gen3.auth")
class Gen3Auth:
    def __init__(self, endpoint=None): self.endpoint = endpoint
gen3_auth.Gen3Auth = Gen3Auth
requests = types.ModuleType("requests")
class R:
    def raise_for_status(self): pass
    def json(self): return {"data": {}}
def post(url, json=None, auth=None, headers=None, timeout=None):
    calls.append({"url": url, "query": json["query"], "filter": json["variables"]["filter"]})
    return R()
requests.post = post
class DF:
    def __init__(self, rows): self.rows = rows; self.columns = list(rows[0].keys()) if rows else []
    def __getitem__(self, cols): return DF([{c: r[c] for c in cols} for r in self.rows])
    def sort_values(self, f, ascending=True): return self
    def reset_index(self, drop=False): return self
    def head(self): return None
pandas = types.ModuleType("pandas"); pandas.DataFrame = DF
sys.modules.update({"gen3": gen3, "gen3.auth": gen3_auth, "requests": requests, "pandas": pandas})
exec(compile(open(sys.argv[1]).read(), sys.argv[1], "exec"), {})
print(json.dumps(calls))
`;
  const run = (code: string) => {
    const file = path.join(dir, `all-${Math.random().toString(16).slice(2)}.py`);
    writeFileSync(file, code);
    const r = spawnSync('python3', ['-c', HARNESS_, file], { encoding: 'utf8' });
    return { ...r, calls: r.status === 0 ? (JSON.parse(r.stdout.split('\n').filter((l) => l.startsWith('[')).pop()!) as { url: string; query: string; filter: unknown }[]) : [] };
  };
  const indexOf = (q: string) => /\{ (\w+)\(filter/.exec(q)![1];

  it('asks every index the same question and none of them for the Index column', () => {
    const r = run(py_(all()));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => indexOf(c.query))).toEqual(['http_activity', 'api_activity', 'authentication', 'network_activity']);
    for (const c of r.calls) {
      expect(c.url).toBe('https://commons.example/guppy/graphql');
      expect(c.query).toContain('event_time src_ip outcome');
      expect(c.query).not.toContain('index_name');
      expect(JSON.stringify(c.filter)).not.toContain('index_name');
    }
  });
  it('an Index filter chooses which indexes are asked, and audit_event means api_activity', () => {
    const only = (op: string, value: unknown) => run(py_(all([{ field: 'index_name', op, value } as FilterClause]))).calls.map((c) => indexOf(c.query));
    expect(only('eq', 'authentication')).toEqual(['authentication']);
    expect(only('eq', 'audit_event')).toEqual(['api_activity']);
    expect(only('neq', 'http_activity')).toEqual(['api_activity', 'authentication', 'network_activity']);
    expect(only('in', ['http_activity', 'network_activity'])).toEqual(['http_activity', 'network_activity']);
  });
  it('refuses an Index filter that leaves nothing, an unsupported operator, and a column list with only Index', () => {
    const contradiction = all([{ field: 'index_name', op: 'eq', value: 'http_activity' }, { field: 'index_name', op: 'eq', value: 'authentication' }] as FilterClause[]);
    expect(() => py_(contradiction)).toThrow(/No index is left/);
    expect(() => py_(all([{ field: 'index_name', op: 'contains', value: 'auth' }] as FilterClause[]))).toThrow(/is not|is one of/);
    expect(() => py_(all([], { columns: ['index_name'] }))).toThrow(/at least one column/);
  });
  it('keeps the window and the other filters, with hostile values intact and nothing executed', () => {
    const spec = all([{ field: 'outcome', op: 'eq', value: HOSTILE[0]! }, { field: 'src_ip', op: 'in', value: HOSTILE.slice(0, 3) }] as FilterClause[]);
    const r = run(py_(spec));
    expect(r.status).toBe(0);
    const f = (JSON.parse(toGraphql({ ...spec, index_name: 'http_activity', columns: ['event_time'] }, 'event_time').variables) as { filter: unknown }).filter;
    for (const c of r.calls) expect(c.filter).toEqual(f);
    expect(existsSync(MARKER)).toBe(false);
  });
  it('GraphQL and curl refuse All events and say what to do instead', () => {
    expect(() => toGraphql(all(), 'event_time')).toThrow(/single index/);
    expect(() => toCurl(all(), { timeField: 'event_time' })).toThrow(/single index/);
  });
});

describe.skipIf(!pandasOk)('toPython for All events with real pandas and a stub gateway', () => {
  const HARNESS = `
import sys, types, json
pages = json.loads(sys.argv[2])
gen3 = types.ModuleType("gen3"); gen3_auth = types.ModuleType("gen3.auth")
class Gen3Auth:
    def __init__(self, endpoint=None): self.endpoint = endpoint
gen3_auth.Gen3Auth = Gen3Auth
requests = types.ModuleType("requests")
class R:
    def __init__(self, p): self.p = p
    def raise_for_status(self): pass
    def json(self): return self.p
import re
def post(url, json=None, auth=None, headers=None, timeout=None):
    index = re.search(r"\\{ (\\w+)\\(filter", json["query"]).group(1)
    return R({"data": {index: pages.get(index, [])}})
requests.post = post
sys.modules.update({"gen3": gen3, "gen3.auth": gen3_auth, "requests": requests})
g = {}
exec(compile(open(sys.argv[1]).read(), sys.argv[1], "exec"), g)
print(json.dumps({"records": g["df"].to_dict(orient="records"), "cols": list(g["df"].columns)}))
`;
  const exec_ = (code: string, pages: Record<string, unknown[]>) => {
    const file = path.join(dir, `allpd-${Math.random().toString(16).slice(2)}.py`);
    writeFileSync(file, code);
    const r = spawnSync('python3', ['-c', HARNESS, file, JSON.stringify(pages)], { encoding: 'utf8' });
    return { ...r, out: r.status === 0 ? (JSON.parse(r.stdout.split('\n').filter((l) => l.startsWith('{')).pop()!) as { records: Record<string, unknown>[]; cols: string[] }) : null };
  };
  it('combines every index into one frame, tagged with the index, in the chosen column order, newest first', () => {
    const spec = specWith([], { index_name: 'all_events', columns: ['index_name', 'event_time', 'src_ip'] });
    const code = toPython(spec, { endpoint: 'https://commons.example', timeField: 'event_time' });
    const r = exec_(code, {
      http_activity: [{ event_time: '2026-10-08T00:00:01Z', src_ip: '192.0.2.1', extra: 1 }],
      authentication: [{ event_time: '2026-10-08T00:00:09Z', src_ip: '192.0.2.2', extra: 2 }],
      api_activity: [{ event_time: '2026-10-08T00:00:05Z', src_ip: '192.0.2.3', extra: 3 }],
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out!.cols).toEqual(['index_name', 'event_time', 'src_ip']);
    expect(r.out!.records.map((x) => [x.index_name, x.src_ip])).toEqual([['authentication', '192.0.2.2'], ['api_activity', '192.0.2.3'], ['http_activity', '192.0.2.1']]);
  });
});

const bash = spawnSync('bash', ['--version']).status === 0;
describe.skipIf(!bash)('toCurl (executed with a stub curl)', () => {
  const curlText = (spec: QuerySpec) => toCurl(spec, { timeField: 'event_time' });
  it('delivers the exact GraphQL body through the heredoc and expands nothing', () => {
    const script = path.join(dir, 'curl.sh');
    writeFileSync(script, `curl() { printf '%s\\n' "$@" > "${dir}/argv"; cat > "${dir}/body"; }\n${curlText(hostileSpec)}`);
    const r = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, VECTIS_TOKEN: 'SECRET-SHOULD-NOT-APPEAR' } });
    expect(r.status).toBe(0);
    expect(existsSync(MARKER)).toBe(false);
    const body = JSON.parse(spawnSync('cat', [`${dir}/body`], { encoding: 'utf8' }).stdout) as { query: string; variables: { filter: unknown } };
    expect(body.variables.filter).toEqual((JSON.parse(toGraphql(hostileSpec, 'event_time').variables) as { filter: unknown }).filter);
    expect(body.query).toContain('first: 250, offset: 0');
    const argv = spawnSync('cat', [`${dir}/argv`], { encoding: 'utf8' }).stdout;
    expect(argv).toContain('/guppy/graphql');
    // the header argument still holds the literal placeholder text, expanded by the user's own shell variable
    expect(argv).toContain('Authorization: Bearer SECRET-SHOULD-NOT-APPEAR');
  });
  it('the text itself contains the placeholder and no token', () => {
    const text = curlText(specWith([]));
    expect(text).toContain('${VECTIS_TOKEN}');
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
  it('refuses a body that contains the heredoc delimiter on its own line', () => {
    // JSON.stringify always indents or quotes, so a bare delimiter line cannot occur; the guard is still tested
    expect(curlText(specWith([{ field: 'uri_path', op: 'eq', value: 'VECTIS_SPEC_JSON' }])).split('\n').filter((l) => l === 'VECTIS_SPEC_JSON')).toHaveLength(1);
  });
});

describe('toGraphql', () => {
  it('keeps every value in the JSON variables, never in the query text', () => {
    const { query, variables } = toGraphql(hostileSpec, 'event_time');
    for (const h of HOSTILE) expect(query).not.toContain(h);
    expect(query).toMatch(/^query VectisRows\(\$filter: JSON, \$sort: JSON\) \{\n {2}http_activity\(filter: \$filter, first: 250, offset: 0, sort: \$sort\) \{/);
    const v = JSON.parse(variables) as { filter: { AND: unknown[] }; sort: unknown };
    expect(v.filter.AND).toHaveLength(2 + cleanSpec(hostileSpec).filters!.length);
    expect(v.sort).toEqual([{ event_time: 'desc' }]);
    expect(variables).toContain(HOSTILE[0]!.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
  });
  it('needs a valid time field and at least one column', () => {
    expect(() => toGraphql(specWith([]), 'bad field')).toThrow(SpecError);
    expect(() => toGraphql(specWith([], { columns: [] }), 'event_time')).toThrow(/at least one column/);
  });
  it('maps each operator', () => {
    const { variables } = toGraphql(specWith([
      { field: 'a', op: 'neq', value: 'x' }, { field: 'b', op: 'gte', value: 5 }, { field: 'c', op: 'lte', value: 9 }, { field: 'd', op: 'in', value: ['p', 'q'] },
    ], { sort: null }), 'event_time');
    const and = (JSON.parse(variables) as { filter: { AND: Record<string, unknown>[] } }).filter.AND.slice(2);
    expect(and).toEqual([{ '!=': { a: 'x' } }, { '>=': { b: 5 } }, { '<=': { c: 9 } }, { IN: { d: ['p', 'q'] } }]);
  });
});

describe('toDrsManifest', () => {
  const rows = [
    { object_id: 'drs://dg.4503/abc-123' },
    { object_id: 'https://evil.example/x', evidence_uri: 'drs://dg.4503/def-456' },
    { evidence_uri: 's3://bucket/key' },
    { object_id: 'drs://dg.4503/abc-123' },
    { object_id: 'drs://host/a"b' },
    { object_id: 'drs://host/<script>' },
    { object_id: 'drs://\nhost/x' },
    { object_id: '' },
    {},
    { object_id: 42 },
  ];
  it('keeps only drs:// URIs and counts what it skipped', () => {
    const m = toDrsManifest(rows);
    expect(m.manifest).toEqual([{ object_id: 'drs://dg.4503/abc-123' }, { object_id: 'drs://dg.4503/def-456' }]);
    expect(m.included).toBe(2);
    expect(m.skipped).toBe(rows.length - 2);
    expect(m.skippedReasons).toEqual({ notDrs: 5, missing: 2, duplicate: 1 });
  });
  it('is empty for no rows', () => {
    expect(toDrsManifest([])).toMatchObject({ included: 0, skipped: 0 });
  });
});

describe('notebook', () => {
  it('stores the cleaned spec under the documented key, then navigates', () => {
    const store: Record<string, string> = {};
    const navigate = vi.fn();
    const r = openInNotebook(hostileSpec, { storage: { setItem: (k, v) => { store[k] = v; } }, navigate, now: new Date('2026-10-09T12:00:00Z') });
    expect(r).toEqual({ ok: true });
    expect(navigate).toHaveBeenCalledWith(NOTEBOOK_PATH);
    const saved = JSON.parse(store[NOTEBOOK_SPEC_STORAGE_KEY]!) as ReturnType<typeof buildNotebookPayload>;
    expect(saved).toMatchObject({ version: 1, kind: 'vectis.query-spec', created_at: '2026-10-09T12:00:00.000Z' });
    expect(saved.spec).toEqual(cleanSpec(hostileSpec));
  });
  it('does not navigate when storage fails or the spec is invalid', () => {
    const navigate = vi.fn();
    const full = { setItem: () => { throw new Error('quota'); } };
    expect(openInNotebook(specWith([]), { storage: full, navigate })).toMatchObject({ ok: false });
    expect(openInNotebook(specWith([], { index_name: 'Not a valid; name' as never }), { storage: { setItem: vi.fn() }, navigate })).toMatchObject({ ok: false });
    expect(navigate).not.toHaveBeenCalled();
  });
  it('accepts any dictionary entity as the index, but only a well-formed name', () => {
    for (const ok of ['ip_address', 'indicator', 'vulnerability_finding', 'all_events']) expect(() => cleanSpec(specWith([], { index_name: ok as never }))).not.toThrow();
    for (const bad of ['', 'Upper', '1abc', 'a-b', 'a b', "x'); import os #", 'x'.repeat(65), 'ip\n']) {
      expect(() => cleanSpec(specWith([], { index_name: bad as never })), JSON.stringify(bad)).toThrow(/index name/);
    }
  });
  it('never carries credentials or rows', () => {
    expect(JSON.stringify(buildNotebookPayload(specWith([])))).not.toMatch(/token|password|Bearer/i);
  });
});

describe('isDrsUri', () => {
  it('accepts ordinary DRS ids', () => {
    expect(isDrsUri('drs://dg.4503/abc-123')).toBe(true);
    expect(isDrsUri('drs://host.org/path/to/object_1.v2')).toBe(true);
  });
  it('rejects traversal segments and shell metacharacters that a consumer might act on', () => {
    for (const bad of ['drs://h/../../etc/x', 'drs://h/a/./b', 'drs://h/..', "drs://host.org/abc'$(id)", 'drs://host.org/a;b', 'drs://host.org/a`b`', 'drs://host.org/a b', 'drs://host.org/a|b']) {
      expect(isDrsUri(bad)).toBe(false);
    }
  });
});

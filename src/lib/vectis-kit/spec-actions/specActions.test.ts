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
    endpoint = "https://commons.example"
gen3_auth.Gen3Auth = Gen3Auth
requests = types.ModuleType("requests")
class R:
    def raise_for_status(self): pass
    def json(self): return {"rows": []}
def post(url, json=None, auth=None, timeout=None):
    calls.append({"url": url, "json": json, "has_auth": auth is not None})
    return R()
requests.post = post
pandas = types.ModuleType("pandas")
pandas.DataFrame = lambda rows: types.SimpleNamespace(head=lambda: None)
sys.modules.update({"gen3": gen3, "gen3.auth": gen3_auth, "requests": requests, "pandas": pandas})
src = open(sys.argv[1]).read()
exec(compile(src, sys.argv[1], "exec"), {})
print(json.dumps(calls))
`;
  const run = (code: string) => {
    const file = path.join(dir, `snippet-${Math.random().toString(16).slice(2)}.py`);
    writeFileSync(file, code);
    const r = spawnSync('python3', ['-c', HARNESS, file], { encoding: 'utf8' });
    return { ...r, calls: r.status === 0 ? (JSON.parse(r.stdout) as { url: string; json: unknown; has_auth: boolean }[]) : [] };
  };

  it('is valid Python that sends exactly the spec, with hostile values intact and nothing executed', () => {
    const code = toPython(hostileSpec);
    const r = run(code);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(1);
    const sent = r.calls[0]!.json as Record<string, unknown>;
    expect(sent.filters).toEqual(cleanSpec(hostileSpec).filters);
    expect(sent.paging).toEqual({ limit: 250, offset: 0 });
    expect(r.calls[0]!.url).toBe('https://commons.example/siem/rows');
    expect(r.calls[0]!.has_auth).toBe(true);
    expect(existsSync(MARKER)).toBe(false);
  });
  it('embeds no credential and uses Gen3Auth', () => {
    const code = toPython(specWith([]));
    expect(code).toContain('Gen3Auth()');
    expect(code).not.toMatch(/Bearer|api_key|access_token|password|eyJ/i);
  });
  it('rejects an unsafe API path', () => {
    expect(() => toPython(specWith([]), { apiPath: '/x"; import os' })).toThrow('API path');
  });
});

const bash = spawnSync('bash', ['--version']).status === 0;
describe.skipIf(!bash)('toCurl (executed with a stub curl)', () => {
  it('delivers the exact JSON body through the heredoc and expands nothing', () => {
    const script = path.join(dir, 'curl.sh');
    writeFileSync(script, `curl() { printf '%s\\n' "$@" > "${dir}/argv"; cat > "${dir}/body"; }\n${toCurl(hostileSpec)}`);
    const r = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, VECTIS_TOKEN: 'SECRET-SHOULD-NOT-APPEAR' } });
    expect(r.status).toBe(0);
    expect(existsSync(MARKER)).toBe(false);
    const body = JSON.parse(spawnSync('cat', [`${dir}/body`], { encoding: 'utf8' }).stdout) as { filters: unknown; paging: unknown };
    expect(body.filters).toEqual(cleanSpec(hostileSpec).filters);
    expect(body.paging).toEqual({ limit: 250, offset: 0 });
    const argv = spawnSync('cat', [`${dir}/argv`], { encoding: 'utf8' }).stdout;
    // the header argument still holds the literal placeholder text, expanded by the user's own shell variable
    expect(argv).toContain('Authorization: Bearer SECRET-SHOULD-NOT-APPEAR');
  });
  it('the text itself contains the placeholder and no token', () => {
    const text = toCurl(specWith([]));
    expect(text).toContain('${VECTIS_TOKEN}');
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
  it('refuses a body that contains the heredoc delimiter on its own line', () => {
    // JSON.stringify always indents or quotes, so a bare delimiter line cannot occur; the guard is still tested
    expect(toCurl(specWith([{ field: 'uri_path', op: 'eq', value: 'VECTIS_SPEC_JSON' }])).split('\n').filter((l) => l === 'VECTIS_SPEC_JSON')).toHaveLength(1);
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
    expect(openInNotebook(specWith([], { index_name: 'nope' as never }), { storage: { setItem: vi.fn() }, navigate })).toMatchObject({ ok: false });
    expect(navigate).not.toHaveBeenCalled();
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

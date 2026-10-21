/**
 * Development and test backend for Jobs: synthetic catalog and runs. The synthetic runs are kept as TES tasks and
 * converted with the SAME fromTesTask the server uses, so the UI (and e2e) exercise the real state mapping.
 * It serves the behaviour the UI needs (filtering, paging, submit, a submitted run that moves QUEUED -> RUNNING -> COMPLETE over a few reads, cancel).
 *
 * It must never run in production: the development page loads this module with a guarded require, so a production
 * build drops it. Everything here is synthetic (reserved example hosts only).
 */
import { cloneDeep } from 'lodash';
import type { Catalog } from '@/lib/jobs/catalog/load';
import { compileJob, compileDagJob } from '@/lib/jobs/jobdef/compile';
import { parseJobDef } from '@/lib/jobs/jobdef/parse';
import { isDagDef } from '@/lib/jobs/jobdef/types';
import type { CatalogDef, DagJobDef, JobDef } from '@/lib/jobs/jobdef/types';
import { fromDagu } from '@/lib/jobs/dagu/map';
import { isRunId } from '@/lib/jobs/model';
import type { Detail, Run, RunList, StorageSetup } from '@/lib/jobs/model';
import { fromTesTask, toTesTask } from '@/lib/jobs/tes/adapter';
import { normalizeTask } from '@/lib/jobs/tes/normalize';
import type { TesState, TesTask } from '@/lib/jobs/tes/types';
import { JobsApiError } from './client';
import type { JobsApi, RunsQuery, SubmitRequest } from './client';

export const FIXTURE_REPO = 'example-org/vectis-jobs';
export const FIXTURE_SHA = '3f9c2a1b7d4e5f60a8b9c0d1e2f3a4b5c6d7e8f9';
const USER_BUCKET = 'vectis-user-fixture';
const NON_TERMINAL: TesState[] = ['QUEUED', 'INITIALIZING', 'RUNNING', 'PAUSED'];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const parse = (file: string): JobDef => {
  const r = parseJobDef(EXAMPLE_YAML[file]);
  if (!r.ok) throw new Error(`fixture ${file} is invalid: ${r.errors.join('; ')}`);
  return r.def;
};

const iso = (now: number, agoSec: number) => new Date(now - agoSec * 1000).toISOString();

interface Seed { id: string; name: string; state: TesState; job?: string; by?: string; ago: number; ran?: number; exit?: Array<number | null>; stdout?: string[]; stderr?: string[]; sys?: string[]; execs?: number }

function seedTask(s: Seed, now: number): TesTask {
  const n = s.execs ?? 1;
  const started = s.state === 'QUEUED' ? null : iso(now, s.ago - 5);
  const ended = s.ran !== undefined ? iso(now, s.ago - 5 - s.ran) : null;
  const wire = {
    id: s.id, state: s.state, name: s.name, description: 'Synthetic run for development.',
    inputs: [{ name: 'log', url: 's3://example-bucket/logs/app.log', path: '/data/input.log', type: 'FILE' }],
    outputs: [{ name: 'result', url: `s3://${USER_BUCKET}/results/${s.id}.json`, path: '/data/result.json', type: 'FILE' }],
    resources: { cpu_cores: 2, ram_gb: 4, disk_gb: 20, preemptible: true },
    executors: Array.from({ length: n }, (_, i) => ({ image: i === 0 ? 'python:3.9-slim' : 'alpine:3.20', command: i === 0 ? ['python', '/opt/job/summarize.py', '--top', '10'] : ['sh', '-c', 'echo done'], env: { PYTHONUNBUFFERED: '1' } })),
    tags: { ...(s.job ? { 'vectis.job': s.job, 'vectis.catalog_sha': FIXTURE_SHA, 'vectis.catalog_repo': FIXTURE_REPO } : {}), 'vectis.submitted_by': s.by ?? 'analyst1' },
    creation_time: iso(now, s.ago),
    logs: s.state === 'QUEUED' ? [] : [{
      start_time: started, end_time: ended,
      logs: Array.from({ length: n }, (_, i) => ({
        start_time: started, end_time: s.exit?.[i] !== undefined && s.exit[i] !== null ? ended : null,
        stdout: s.stdout?.[i] ?? `step ${i + 1} started\nprocessed 1204 lines\n`, stderr: s.stderr?.[i] ?? '', exit_code: s.exit?.[i] ?? null,
      })),
      outputs: s.state === 'COMPLETE' ? [{ url: `s3://${USER_BUCKET}/results/${s.id}.json`, path: '/data/result.json', size_bytes: '48213' }] : [],
      system_logs: s.sys ?? [],
    }],
  };
  return normalizeTask(wire)!;
}

const HOSTILE_OUT = '<img src=x onerror="alert(1)"> <script>alert("xss")</script>\n\u001b[31mred text\u001b[0m ‮gnp.exe\n<b>bold?</b> &lt;escaped&gt; javascript:alert(1)\n';
const LONG = Array.from({ length: 400 }, (_, i) => `line ${i + 1}: processed batch ${i * 37} ok`).join('\n') + '\n';

function seeds(): Seed[] {
  return [
    { id: 'run-0001', name: 'Log summary', state: 'RUNNING', job: 'log-summary', ago: 90, exit: [null] },
    { id: 'run-0002', name: 'Log summary', state: 'COMPLETE', job: 'log-summary', ago: 3600, ran: 84, exit: [0], stdout: [LONG] },
    { id: 'run-0003', name: 'Hello', state: 'COMPLETE', job: 'hello', ago: 7300, ran: 3, exit: [0], stdout: ['Hello from Vectis Jobs\n'] },
    { id: 'run-0004', name: 'Log summary', state: 'EXECUTOR_ERROR', job: 'log-summary', ago: 9000, ran: 12, exit: [2], stdout: ['reading input\n'], stderr: ['Traceback (most recent call last):\n  File "/opt/job/summarize.py", line 41, in <module>\n    top = counts.most_common(n)\nValueError: no such field: status\n'] },
    { id: 'run-0005', name: 'Log summary', state: 'SYSTEM_ERROR', job: 'log-summary', ago: 12000, ran: 2, exit: [null], sys: ['failed to pull image python:3.9-slim: rate limited', 'task terminated by the scheduler'] },
    { id: 'run-0006', name: 'Hello', state: 'CANCELED', job: 'hello', ago: 20000, ran: 1, exit: [null] },
    { id: 'run-0007', name: 'Log summary', state: 'QUEUED', job: 'log-summary', ago: 20, by: 'analyst2' },
    { id: 'run-0008', name: 'Nightly export', state: 'INITIALIZING', job: 'export-report', ago: 45, exit: [null], execs: 1 },
    { id: 'run-0009', name: 'Two step check', state: 'PAUSED', ago: 400, exit: [0, null], execs: 2 },
    { id: 'run-0010', name: 'Three step pipeline', state: 'COMPLETE', ago: 30000, ran: 640, exit: [0, 0, 0], execs: 3, stdout: ['fetched\n', 'transformed\n', 'published\n'] },
    { id: 'run-0011', name: 'Spot instance run', state: 'PREEMPTED', job: 'log-summary', ago: 40000, ran: 300, exit: [null] },
    { id: 'run-0012', name: '<img src=x onerror=alert(1)> hostile name', state: 'COMPLETE', ago: 50000, ran: 9, exit: [0], stdout: [HOSTILE_OUT], stderr: ['<script>document.title="pwned"</script>\n'], sys: ['<svg onload=alert(1)>'] },
    { id: 'run-0013', name: 'Missing times', state: 'UNKNOWN', ago: 60000 },
  ];
}


// ---------------------------------------------------------------- workflow (DAG) fixtures: Dagu-shaped wire data through the real mapper
/** Catalog entries for the sample workflows. The graphs equal what the catalog loader derives from the sample native definitions (a unit test, dagu/catalog.test.ts, keeps them identical). */
export const DAG_FIXTURE_DEFS: DagJobDef[] = [
  { schema_version: 1, kind: 'dag', engine: 'dagu', id: 'dag-hello', name: 'Hello workflow', description: 'Smallest possible DAG: two steps in sequence.', tags: ['example', 'dag'], definition: 'dags/hello.yaml', owner: 'platform',
    graph: [{ name: 'greet', depends_on: [], executor: 'command' }, { name: 'finish', depends_on: ['greet'], executor: 'command' }] },
  { schema_version: 1, kind: 'dag', engine: 'dagu', id: 'dag-fanout', name: 'Fan-out and join', description: 'Three parallel branches that join into one final step.', tags: ['example', 'dag'], definition: 'dags/fanout.yaml', owner: 'platform',
    params: [{ name: 'label', label: 'Label', description: 'Short label printed by each branch', type: 'string', default: 'demo', pattern: '^[A-Za-z0-9_.-]{1,32}$', max_length: 32 }],
    graph: [{ name: 'branch_a', depends_on: [], executor: 'command' }, { name: 'branch_b', depends_on: [], executor: 'command' }, { name: 'branch_c', depends_on: [], executor: 'command' }, { name: 'join', depends_on: ['branch_a', 'branch_b', 'branch_c'], executor: 'command' }] },
  { schema_version: 1, kind: 'dag', engine: 'dagu', id: 'dag-soc-enrich', name: 'SOC: enrich an indicator', description: 'Look up an indicator, shape the answer with jq and notify a webhook. Native executors only (http, jq).', tags: ['soc', 'dag'], definition: 'dags/soc-enrich-indicator.yaml', owner: 'security-engineering',
    params: [{ name: 'indicator', label: 'Indicator', description: 'IP address or domain', type: 'string', required: true, pattern: '^[A-Za-z0-9_.:-]{1,128}$', max_length: 128 }],
    graph: [{ name: 'enrich', depends_on: [], executor: 'http.request' }, { name: 'shape', depends_on: ['enrich'], executor: 'jq.filter' }, { name: 'notify', depends_on: ['shape'], executor: 'http.request' }] },
];

type NodeSeed = { id: string; deps?: string[]; status: number; ago?: number; ran?: number; error?: string; out?: string; err?: string; exec?: string };
const NODE_LABEL: Record<number, string> = { 0: 'not_started', 1: 'running', 2: 'failed', 3: 'aborted', 4: 'succeeded', 5: 'skipped' };
function dagWire(o: { name: string; id: string; status: number; label: string; ago: number; ran?: number; params?: string; by?: string; job?: string; nodes: NodeSeed[]; now: number }) {
  const t = (agoSec: number | undefined) => (agoSec === undefined ? '' : iso(o.now, agoSec));
  return {
    name: o.name, dagRunId: o.id, status: o.status, statusLabel: o.label, queuedAt: t(o.ago + 1), startedAt: t(o.ago), finishedAt: o.ran === undefined ? '' : t(o.ago - o.ran),
    params: o.params ?? '', labels: [`vectis.job=${o.job ?? o.name}`, `vectis.submitted_by=${o.by ?? 'analyst1'}`, `vectis.catalog_repo=${FIXTURE_REPO.toLowerCase()}`],
    nodes: o.nodes.map((n) => ({
      step: { name: n.id, id: n.id, depends: n.deps ?? [], commands: n.exec === undefined || n.exec === 'command' ? [{ command: 'echo', args: [`${n.id} for ${o.params ?? 'demo'}`] }] : [], executorConfig: n.exec && n.exec !== 'command' ? { type: n.exec, config: {} } : { config: {} } },
      status: n.status, statusLabel: NODE_LABEL[n.status], startedAt: n.status === 0 || n.status === 5 ? '' : t(n.ago ?? o.ago), finishedAt: n.status === 1 || n.status === 0 ? '' : t((n.ago ?? o.ago) - (n.ran ?? 1)), error: n.error ?? '',
      stdout: '', stderr: '',
    })),
    _logs: Object.fromEntries(o.nodes.map((n) => [n.id, { stdout: n.out ?? (n.status === 4 ? `${n.id} done\n` : ''), stderr: n.err ?? '', truncated: false }])),
  };
}
function dagRuns(now: number): Run[] {
  const mk = (w: ReturnType<typeof dagWire>) => fromDagu(w, (s) => (w._logs as Record<string, { stdout: string; stderr: string; truncated: boolean }>)[s]) as Run;
  return [
    mk(dagWire({ now, name: 'fanout', id: 'fx0001', status: 4, label: 'succeeded', ago: 700, ran: 9, params: 'label=nightly', job: 'dag-fanout', nodes: [
      { id: 'branch_a', status: 4, ran: 2, out: 'branch a for nightly\n' }, { id: 'branch_b', status: 4, ran: 4, out: 'branch b for nightly\n' }, { id: 'branch_c', status: 4, ran: 3, out: 'branch c for nightly\n' },
      { id: 'join', deps: ['branch_a', 'branch_b', 'branch_c'], status: 4, ago: 696, ran: 1, out: 'joined nightly\n' }] })),
    mk(dagWire({ now, name: 'fanout', id: 'fx0002', status: 2, label: 'failed', ago: 1500, ran: 8, params: 'label=weekly', job: 'dag-fanout', nodes: [
      { id: 'branch_a', status: 4, ran: 2, out: 'branch a for weekly\n' },
      { id: 'branch_b', status: 2, ran: 3, error: 'exit status 3', out: 'starting branch b\n', err: 'branch b: upstream returned 503\n' },
      { id: 'branch_c', status: 4, ran: 3, out: 'branch c for weekly\n' },
      { id: 'join', deps: ['branch_a', 'branch_b', 'branch_c'], status: 5, error: 'upstream failed' }] })),
    mk(dagWire({ now, name: 'soc-enrich-indicator', id: 'fx0003', status: 1, label: 'running', ago: 40, params: 'indicator=203.0.113.9', job: 'dag-soc-enrich', nodes: [
      { id: 'enrich', status: 4, ran: 2, exec: 'http', out: '{"indicator":"203.0.113.9","score":87}\n' },
      { id: 'shape', deps: ['enrich'], status: 1, ago: 36, exec: 'jq', out: '' },
      { id: 'notify', deps: ['shape'], status: 0, exec: 'http' }] })),
    mk(dagWire({ now, name: 'hello', id: 'fx0004', status: 4, label: 'succeeded', ago: 5200, ran: 2, job: 'dag-hello', nodes: [
      { id: 'greet', status: 4, ran: 1, out: 'Hello from Vectis Jobs\n' }, { id: 'finish', deps: ['greet'], status: 4, ago: 5199, ran: 1, out: 'done\n' }] })),
  ];
}

export interface FixtureOptions {
  delayMs?: number;
  catalog?: 'full' | 'none' | 'empty';
  now?: number;
}

/** Groups the development page offers, so the group choice and the shared runs can be tried without a cluster. */
const FIXTURE_GROUPS = ['soc', 'platform'];
export function createFixtureApi(opts: FixtureOptions = {}): JobsApi {
  const delayMs = opts.delayMs ?? 60;
  const now = opts.now ?? Date.now();
  const mode = opts.catalog ?? 'full';
  const defs: Array<{ file: string; def: CatalogDef }> = [
    ...['hello.yaml', 'log-summary.yaml', 'export-report.yaml'].map((f) => ({ file: f, def: parse(f) as CatalogDef })),
    ...DAG_FIXTURE_DEFS.map((d) => ({ file: `${d.id}.yaml`, def: d as CatalogDef })),
  ];
  const catalog: Catalog = mode === 'none'
    ? { configured: false, repo: null, ref: null, sha: null, fetched_at: null, jobs: [], errors: [] }
    : {
      configured: true, repo: FIXTURE_REPO, ref: 'main', sha: FIXTURE_SHA, fetched_at: iso(now, 240),
      jobs: mode === 'empty' ? [] : defs,
      errors: mode === 'empty' ? [] : [{ file: 'broken-job.yaml', errors: ['/image must be string', 'command[1]: placeholder in a program name or after a shell/inline-code interpreter is not allowed'] }],
    };

  const tasks: TesTask[] = seeds().map((s) => seedTask(s, now));
  const dags: Run[] = dagRuns(now);
  if (dags[0]) dags[0] = { ...dags[0], title: 'Friday WAF review', group: 'soc' };
  if (dags[1]) dags[1] = { ...dags[1], title: 'Quarterly export check' };
  const gone = dags.findIndex((r) => r.name === 'hello' && r.state === 'succeeded'); // a finished run the workflow server has since forgotten
  if (gone >= 0) dags[gone] = { ...dags[gone], archived: true };
  const dagReads = new Map<string, number>(); // a submitted workflow run is `running` for its first reads, then `succeeded`
  const reads = new Map<string, number>(); // submitted runs advance on every read
  let counter = 100;

  /** A run submitted here is QUEUED for its first reads, then RUNNING, then COMPLETE. */
  const advance = (t: TesTask) => {
    const n = reads.get(t.id);
    if (n === undefined || !NON_TERMINAL.includes(t.state) || t.state === 'PAUSED') return;
    reads.set(t.id, n + 1);
    const next: TesState = n < 2 ? 'QUEUED' : n < 4 ? 'RUNNING' : 'COMPLETE';
    if (next === t.state) return;
    t.state = next;
    const started = new Date().toISOString();
    if (next === 'RUNNING') t.logs = [{ start_time: started, end_time: null, logs: t.executors.map(() => ({ start_time: started, end_time: null, stdout: 'started\n', stderr: '', stdout_truncated: false, stderr_truncated: false, exit_code: null })), outputs: [], metadata: {}, system_logs: [] }];
    if (next === 'COMPLETE') {
      const end = new Date().toISOString();
      t.logs = [{ start_time: t.logs[0]?.start_time ?? started, end_time: end, logs: t.executors.map((x) => ({ start_time: t.logs[0]?.start_time ?? started, end_time: end, stdout: `${x.command.join(' ')}\nfinished without errors\n`, stderr: '', stdout_truncated: false, stderr_truncated: false, exit_code: 0 })), outputs: t.outputs.map((o) => ({ url: o.url, path: o.path, size_bytes: '2048' })), metadata: {}, system_logs: [] }];
    }
  };
  const view = (t: TesTask, v: Detail) => {
    const c = cloneDeep(t);
    if (v !== 'full') c.logs = c.logs.map((l) => ({ ...l, system_logs: [], logs: l.logs.map((x) => ({ ...x, stdout: '', stderr: '' })) }));
    return fromTesTask(c);
  };

  const advanceDag = (r: Run) => {
    const n = dagReads.get(r.id);
    if (n === undefined || r.state !== 'running') return;
    dagReads.set(r.id, n + 1);
    if (n < 3) return;
    const end = new Date().toISOString();
    r.state = 'succeeded'; r.backend_state = 'succeeded'; r.ended_at = end;
    r.steps = r.steps.map((x) => ({ ...x, state: 'succeeded' as const, exit_code: 0, started_at: x.started_at ?? end, ended_at: end, stdout: x.stdout || `${x.name} done\n` }));
  };
  const dagView = (r: Run, v: Detail): Run => {
    const c = cloneDeep(r);
    if (v !== 'full') c.steps = c.steps.map((x) => ({ ...x, stdout: '', stderr: '' }));
    return c;
  };

  return {
    mode: 'fixtures',
    async listRuns(q: RunsQuery): Promise<RunList> {
      await sleep(delayMs);
      tasks.forEach(advance);
      const size = q.page_size ?? 25;
      const all: Array<{ at: number; run: Run }> = [
        ...tasks.map((t) => ({ at: Date.parse(t.creation_time ?? ''), run: view(t, q.detail ?? 'summary') })),
        ...dags.map((r) => { advanceDag(r); return { at: Date.parse(r.created_at ?? ''), run: dagView(r, q.detail ?? 'summary') }; }),
      ];
      const rows = all
        .filter((x) => (q.scope === 'mine' ? !x.run.group : q.scope === 'shared' ? !!x.run.group : true))
        .filter((x) => (q.state ? x.run.state === q.state : true) && (q.name_prefix ? x.run.name.startsWith(q.name_prefix) || (x.run.title ?? '').toLowerCase().includes(q.name_prefix.toLowerCase()) : true))
        .sort((a, b) => b.at - a.at);
      const offset = q.page_token && /^\d{1,6}$/.test(q.page_token) ? Number(q.page_token) : 0;
      const runs = rows.slice(offset, offset + size).map((x) => x.run);
      return { runs, next_page_token: offset + size < rows.length ? String(offset + size) : null };
    },
    async getRun(id, d) {
      await sleep(delayMs);
      if (!isRunId(id)) throw new JobsApiError(400, 'Invalid run id.');
      const dr = dags.find((x) => x.id === id);
      if (dr) { advanceDag(dr); return dagView(dr, d); }
      const t = tasks.find((x) => x.id === id);
      if (!t) throw new JobsApiError(404, 'Run not found.');
      advance(t);
      return view(t, d);
    },
    async serviceInfo() { await sleep(delayMs); return { name: 'Vectis jobs (fixture)', version: '1.1.0' }; },
    async storageSetup(): Promise<StorageSetup> { await sleep(delayMs); return { bucket: USER_BUCKET, region: 'us-east-1', endpoint: null }; },
    async catalog() { await sleep(delayMs); return cloneDeep(catalog); },
    async submitJob(req: SubmitRequest) {
      await sleep(delayMs);
      const def = catalog.jobs.find((j) => j.def.id === req.job)?.def;
      if (!def) throw new JobsApiError(404, 'Unknown job.');
      if (isDagDef(def)) {
        const dc = compileDagJob(def, { text: '', dag_name: def.id }, req.params, { repo: FIXTURE_REPO, sha: FIXTURE_SHA });
        if (!dc.ok) throw new JobsApiError(400, 'The parameters were refused.', dc.errors);
        counter += 1;
        const id = `${def.definition.replace(/^.*\//, '').replace(/\.ya?ml$/, '')}.fx${String(counter).padStart(4, '0')}`;
        const nowIso = new Date().toISOString();
        const w = dagWire({ now: Date.now(), name: id.split('.')[0], id: id.split('.')[1], status: 1, label: 'running', ago: 0, params: Object.entries(dc.spec.dag?.params ?? {}).map(([k, v]) => `${k}=${v}`).join(' '), job: def.id, by: 'you',
          nodes: (def.graph ?? []).map((g) => ({ id: g.name, deps: g.depends_on, status: 0, exec: g.executor === 'command' ? 'command' : g.executor.split('.')[0] })) });
        const run = { ...(fromDagu({ ...w, startedAt: nowIso, queuedAt: nowIso }) as Run), ...(req.title ? { title: req.title } : {}), ...(req.group && FIXTURE_GROUPS.includes(req.group) ? { group: req.group } : {}) };
        dags.push(run); dagReads.set(run.id, 0);
        return { id: run.id, warnings: [] };
      }
      const c = compileJob(def, req.params, { repo: FIXTURE_REPO, sha: FIXTURE_SHA, userBucket: USER_BUCKET });
      if (!c.ok) throw new JobsApiError(400, 'The parameters were refused.', c.errors);
      counter += 1;
      const id = `run-${String(counter).padStart(4, '0')}`;
      const task = toTesTask(c.spec);
      const t = normalizeTask({ ...task, id, state: 'QUEUED', creation_time: new Date().toISOString(), tags: { ...task.tags, 'vectis.submitted_by': 'you' }, logs: [] })!;
      tasks.push(t);
      reads.set(id, 0);
      return { id, warnings: c.spec.warnings };
    },
    async checkYaml(yaml: string, _params?: Record<string, string | number | boolean>) {
      await sleep(delayMs);
      if (!/^steps:/m.test(yaml)) throw new JobsApiError(400, 'The workflow was refused.', ['steps: a workflow needs a steps: list']);
      return { name: /^name:\s*(\S+)/m.exec(yaml)?.[1] ?? 'adhoc', steps: (yaml.match(/^\s*-\s+(id|name):/gm) ?? []).length, warnings: ['This workflow was pasted, not read from the job catalog.'] };
    },
    async submitYaml(yaml: string, _params?: Record<string, string | number | boolean>, choices?: { title?: string; group?: string }) {
      const c = await this.checkYaml(yaml);
      counter += 1;
      const id = `${c.name}.fx${String(counter).padStart(4, '0')}`;
      const nowIso = new Date().toISOString();
      const w = dagWire({ now: Date.now(), name: c.name, id: id.split('.')[1], status: 1, label: 'running', ago: 0, params: '', job: 'adhoc', by: 'you', nodes: [] });
      const run = { ...(fromDagu({ ...w, startedAt: nowIso, queuedAt: nowIso }) as Run), ...(choices?.title ? { title: choices.title } : {}), ...(choices?.group && FIXTURE_GROUPS.includes(choices.group) ? { group: choices.group } : {}) };
      dags.push(run); dagReads.set(run.id, 0);
      return { id: run.id, warnings: c.warnings };
    },
    async runResults(id: string) {
      await sleep(delayMs);
      if (!dags.some((x) => x.id === id)) throw new JobsApiError(404, 'Run not found.');
      return FIXTURE_RESULTS.map((f) => ({ name: f.name, size: f.text.length }));
    },
    async resultText(id: string, name: string) {
      await sleep(delayMs);
      const f = FIXTURE_RESULTS.find((x) => x.name === name);
      if (!f || !dags.some((x) => x.id === id)) throw new JobsApiError(404, 'No such result.');
      return f.text;
    },
    resultUrl(id: string, name: string) { return `/api/jobs/runs/${encodeURIComponent(id)}/results/${encodeURIComponent(name)}?download=1`; },
    async groups() { await sleep(delayMs); return [...FIXTURE_GROUPS]; },
    async renameRun(id, title) {
      await sleep(delayMs);
      const dr = dags.find((x) => x.id === id);
      if (!dr) throw new JobsApiError(404, 'Run not found.');
      if (title.trim()) dr.title = title.trim(); else delete dr.title;
      return dagView(dr, 'summary');
    },
    async cancelRun(id) {
      await sleep(delayMs);
      const dr = dags.find((x) => x.id === id);
      if (dr) {
        if (dr.state !== 'running' && dr.state !== 'queued') throw new JobsApiError(409, 'This run has already finished.');
        dr.state = 'cancelled'; dr.backend_state = 'aborted'; dr.ended_at = new Date().toISOString(); dagReads.delete(id);
        dr.steps = dr.steps.map((x) => (x.state === 'succeeded' ? x : { ...x, state: 'cancelled' as const }));
        return;
      }
      const t = tasks.find((x) => x.id === id);
      if (!t) throw new JobsApiError(404, 'Run not found.');
      if (!NON_TERMINAL.includes(t.state)) throw new JobsApiError(409, 'This run has already finished.');
      t.state = 'CANCELED';
      reads.delete(id);
    },
  };
}

/** Synthetic result files for the development fixtures: a Markdown report, an HTML report and a JSON summary. */
const FIXTURE_RESULTS: Array<{ name: string; text: string }> = [
  { name: 'sample_report.md', text: '# Sample investigation\n\n## Final assessment\n\n- Suspicion level: **high**\n- Hypothesis: likely reconnaissance or scanning\n\n| Source IP | Requests | Score |\n| --- | --- | --- |\n| 203.0.113.12 | 97 | 100 |\n| 203.0.113.11 | 96 | 100 |\n\nSee the HTML report for the full picture.\n' },
  { name: 'sample_report.html', text: '<html><body style="font-family:sans-serif"><h2>Sample report</h2><p>Rendered in a locked-down frame.</p><script>document.title = "scripts must not run"</script></body></html>' },
  { name: 'sample_summary.json', text: JSON.stringify({ suspicion: 'high', top_ips: ['203.0.113.12', '203.0.113.11'], requests: 668 }) },
  { name: 'sample.executed.ipynb', text: '{"cells": []}' },
];

/** Catalog definitions for the development fixtures. Synthetic: the real catalog is loaded at run time from the catalog repository and nothing here ships to production. */
export const EXAMPLE_YAML: Record<string, string> = {
  "hello.yaml": "schema_version: 1\nid: hello\nname: Hello\ndescription: Smallest possible job. Prints a greeting and exits.\ntags: [example]\nimage: alpine:3.20\ncommand: [echo, \"Hello from Vectis Jobs\"]\nresources:\n  cpu_cores: 1\n  ram_gb: 0.5\nowner: platform\n",
  "log-summary.yaml": "# Summarise a log file in S3 and write result.json back to S3.\n# Credentials are never written here: the job reads and writes through the TES storage\n# (task inputs/outputs), so it needs no AWS keys. If one is ever needed, use secret://<name>.\nschema_version: 1\nid: log-summary\nname: Log summary\ndescription: Counts events in a log file and writes the top N values to result.json.\ntags: [logs, python]\nowner: platform\nimage: python:3.9-slim\nparams:\n  - name: input_url\n    label: Log file\n    description: s3:// URL of the log file to summarise\n    type: s3_url\n    required: true\n  - name: output_url\n    label: Result location\n    description: s3:// URL where result.json is written\n    type: s3_url\n    required: true\n  - name: top_n\n    label: Top N\n    type: integer\n    default: 10\n    min: 1\n    max: 100\n  - name: field\n    label: Field name\n    type: string\n    default: status\n    pattern: \"^[a-z_]{1,32}$\"\n    max_length: 32\ninputs:\n  - name: log\n    url: \"{{input_url}}\"\n    path: /data/input.log\n  - name: script\n    description: Script mounted into the container (kept in the job bucket, not inline)\n    url: s3://example-job-scripts/log-summary/summarize.py\n    path: /opt/job/summarize.py\noutputs:\n  - name: result\n    url: \"{{output_url}}\"\n    path: /data/result.json\n# No shell: arguments are passed as an argv array, so parameter values are never parsed as code.\ncommand:\n  - python\n  - /opt/job/summarize.py\n  - --input\n  - /data/input.log\n  - --output\n  - /data/result.json\n  - --top\n  - \"{{top_n}}\"\n  - --field\n  - \"{{field}}\"\nenv:\n  PYTHONUNBUFFERED: \"1\"\nresources:\n  cpu_cores: 2\n  ram_gb: 4\n  disk_gb: 20\n  preemptible: true\ntimeout_seconds: 3600\n",
  "export-report.yaml": "schema_version: 1\nid: export-report\nname: Export report\ndescription: Builds a CSV report and writes it to your personal storage bucket. Needs a reporting API token.\ntags: [reports, export]\nowner: security-engineering\nimage: python:3.9-slim\nparams:\n  - name: report\n    label: Report\n    description: Which report to build\n    type: enum\n    values: [daily-summary, top-talkers, blocked-requests]\n    required: true\n  - name: days\n    label: Days to include\n    type: integer\n    default: 7\n    min: 1\n    max: 90\n  - name: include_blocked\n    label: Include blocked requests\n    type: boolean\n    default: true\n  - name: source_url\n    label: Reference list\n    description: Optional https URL of an allow list to apply\n    type: http_url\noutputs:\n  - name: report\n    url: \"s3://{{user_bucket}}/reports/{{report}}.csv\"\n    path: /data/report.csv\ncommand:\n  - python\n  - /opt/job/export.py\n  - --report\n  - \"{{report}}\"\n  - --days\n  - \"{{days}}\"\n  - --out\n  - /data/report.csv\nenv:\n  REPORT_API_TOKEN: secret://reporting-api-token\nresources:\n  cpu_cores: 1\n  ram_gb: 2\nsecrets: [reporting-api-token]\n"
};

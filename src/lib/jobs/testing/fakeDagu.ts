/**
 * TEST ONLY. An in-memory stand-in for the small part of the Dagu REST API the runner uses, with the behaviours that were
 * observed on a real Dagu 2.19.1 (see README): 409 on a repeated dagRunId, label values restricted to [a-z0-9-_./] and
 * lower-cased, `labels` filter, '' for times that have not happened, `latest` alias, 404 body, step log {content}.
 * The REAL server is exercised by the opt-in contract test (npm run test:dagu); this fake only makes unit tests fast.
 */
import { parse } from 'yaml';

interface FakeRun { name: string; id: string; labels: string[]; params: string; status: number; label: string; nodes: Array<{ id: string; deps: string[]; status: number; error?: string }>; created: number; stopped?: boolean }
interface FakeOptions { authorization: string; ignoreLabelFilter?: boolean; onRequest?: (m: string, url: URL, init: RequestInit) => void }
const STATUS_LABEL: Record<number, string> = { 0: 'not_started', 1: 'running', 2: 'failed', 3: 'aborted', 4: 'succeeded', 5: 'queued' };
const j = (status: number, body: unknown) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createFakeDagu(opts: FakeOptions) {
  const runs: FakeRun[] = [];
  const calls: Array<{ method: string; path: string; body?: unknown; headers: Record<string, string> }> = [];
  const logs = new Map<string, { stdout: string; stderr: string }>();
  const details = (r: FakeRun) => ({
    name: r.name, dagRunId: r.id, status: r.status, statusLabel: STATUS_LABEL[r.status] ?? 'x', params: r.params, labels: r.labels,
    startedAt: '2026-10-12T16:00:00Z', finishedAt: r.status === 1 ? '' : '2026-10-12T16:00:05Z', queuedAt: '2026-10-12T15:59:59Z', log: '/var/lib/dagu/logs/x.log',
    nodes: r.nodes.map((n) => ({ step: { name: n.id, id: n.id, depends: n.deps, commands: [{ command: 'echo', args: ['hi'] }] }, status: n.status, statusLabel: STATUS_LABEL[n.status] ?? 'x', startedAt: n.status === 0 ? '' : '2026-10-12T16:00:01Z', finishedAt: n.status === 1 || n.status === 0 ? '' : '2026-10-12T16:00:02Z', error: n.error ?? '' })),
  });
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, path: url.pathname + url.search, body, headers });
    opts.onRequest?.(method, url, init);
    const p = url.pathname.replace(/^.*?\/api\/v1/, '');
    if (p === '/health') return j(200, { status: 'healthy', version: '2.19.1', uptime: 5, timestamp: 'x' });
    if (headers.authorization !== opts.authorization) return j(401, { code: 'unauthorized', message: 'nope' });
    if (method === 'POST' && p === '/dag-runs') {
      const b = body as { spec: string; name?: string; params?: string; dagRunId?: string; labels?: string[] };
      const doc = parse(b.spec) as { name?: string; steps: Array<{ id?: string; name?: string; depends?: string[] }> };
      const name = doc.name ?? b.name ?? '';
      for (const l of b.labels ?? []) {
        const [k, v = ''] = l.split('=');
        if (!/^[A-Za-z0-9._-]+$/.test(k) || !/^[A-Za-z0-9_./-]*$/.test(v.toLowerCase())) return j(400, { code: 'bad_request', message: `invalid labels: ${l}` });
      }
      if (runs.some((r) => r.name === name && r.id === b.dagRunId)) return j(409, { code: 'already_exists', message: `dag-run ID ${b.dagRunId} already exists for DAG ${name}` });
      runs.push({ name, id: b.dagRunId as string, labels: (b.labels ?? []).map((l) => l.toLowerCase()), params: Object.entries(JSON.parse(b.params ?? '{}') as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(' '), status: 1, label: 'running', created: runs.length,
        nodes: doc.steps.map((s) => ({ id: (s.id ?? s.name) as string, deps: s.depends ?? [], status: 1 })) });
      return j(200, { dagRunId: b.dagRunId });
    }
    if (method === 'GET' && p === '/dag-runs') {
      let rs = [...runs].reverse();
      const labels = url.searchParams.getAll('labels');
      if (!opts.ignoreLabelFilter) rs = rs.filter((r) => labels.every((l) => r.labels.includes(l.toLowerCase())));
      const st = url.searchParams.getAll('status').map(Number);
      if (st.length) rs = rs.filter((r) => st.includes(r.status));
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const off = Number(url.searchParams.get('cursor') ?? 0) || 0;
      const page = rs.slice(off, off + limit);
      return j(200, { dagRuns: page.map((r) => ({ ...details(r), nodes: undefined, log: undefined })), ...(off + limit < rs.length ? { nextCursor: String(off + limit) } : {}) });
    }
    const m = /^\/dag-runs\/([^/]+)\/([^/]+)(\/stop|\/steps\/([^/]+)\/log)?$/.exec(p);
    if (m) {
      const [, name, id, tail, step] = m;
      let r = runs.find((x) => x.name === name && x.id === id);
      if (id === 'latest') r = [...runs].reverse().find((x) => x.name === name);
      if (!r) return j(404, { code: 'not_found', message: `dag-run ID ${id} not found for DAG ${name}` });
      if (!tail && method === 'GET') return j(200, { dagRunDetails: details(r) });
      if (tail === '/stop' && method === 'POST') { r.stopped = true; r.status = 3; r.nodes.forEach((n) => { if (n.status === 1) n.status = 3; }); return j(200, undefined); }
      if (step && method === 'GET') {
        const l = logs.get(`${name}/${id}/${step}`) ?? { stdout: '', stderr: '' };
        return j(200, { content: url.searchParams.get('stream') === 'stderr' ? l.stderr : l.stdout });
      }
    }
    return j(404, { code: 'not_found', message: 'no such route' });
  };
  return {
    fetch: fetchImpl as unknown as typeof fetch, runs, calls, logs,
    settle(name: string, id: string, status: 2 | 4, nodeStatuses?: Record<string, number>, errors?: Record<string, string>) {
      const r = runs.find((x) => x.name === name && x.id === id) as FakeRun;
      r.status = status; r.label = STATUS_LABEL[status];
      r.nodes.forEach((n) => { n.status = nodeStatuses?.[n.id] ?? (status === 4 ? 4 : n.status === 1 ? 4 : n.status); if (errors?.[n.id]) n.error = errors[n.id]; });
    },
  };
}

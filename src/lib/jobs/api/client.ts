import type { Catalog } from '@/lib/jobs/catalog/load';
import type { Detail, Run, RunList, RunState, StorageSetup } from '@/lib/jobs/model';
import { isRunId, normalizeRun, normalizeRunList, normalizeServiceInfo, normalizeStorageSetup } from '@/lib/jobs/model';
import { sanitizeText, sanitizeUntrusted } from '@/lib/safe-text';

/** A failed call. `status` 401/403 mean sign-in/permission; 0 means the service could not be reached. */
export class JobsApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details: string[] = []) {
    super(message);
    this.name = 'JobsApiError';
  }
}

export interface ResultFile { name: string; size: number }
const RESULT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MAX_RESULT_TEXT = 5 * 1024 * 1024;

export type RunsScope = 'mine' | 'shared' | 'all';
export interface RunsQuery { state?: RunState; name_prefix?: string; page_size?: number; page_token?: string; detail?: Detail; scope?: RunsScope }
/** `title` names the run; `group` starts it as a group you are in (the group owns it and every member sees it). Both are optional. */
export interface SubmitRequest { job: string; params: Record<string, string | number | boolean>; title?: string; group?: string }
export interface SubmitChoices { title?: string; group?: string }
export interface SubmitResult { id: string; warnings: string[] }
export type CatalogResponse = Catalog;

/** The one interface the UI talks to. It never mentions a runner. A live implementation and a development fixture implementation exist. */
export interface JobsApi {
  readonly mode: 'live' | 'fixtures';
  listRuns(q: RunsQuery, signal?: AbortSignal): Promise<RunList>;
  /** `steps`: ask for the logs of exactly these steps (a workflow runner fetches logs for failed/running steps by default) */
  getRun(id: string, detail: Detail, signal?: AbortSignal, steps?: readonly string[]): Promise<Run>;
  serviceInfo(signal?: AbortSignal): Promise<{ name?: string; version?: string }>;
  storageSetup(signal?: AbortSignal): Promise<StorageSetup>;
  catalog(signal?: AbortSignal): Promise<CatalogResponse>;
  submitJob(req: SubmitRequest): Promise<SubmitResult>;
  /** Run a pasted workflow definition (no catalog involved). `checkYaml` lints it and runs nothing. */
  submitYaml(yaml: string, params?: Record<string, string | number | boolean>, choices?: SubmitChoices): Promise<SubmitResult>;
  checkYaml(yaml: string, params?: Record<string, string | number | boolean>): Promise<{ name: string; steps: number; warnings: string[] }>;
  cancelRun(id: string): Promise<void>;
  /** The groups you may run as. Empty when there are none (then the choice is not shown). */
  groups(signal?: AbortSignal): Promise<string[]>;
  /** Give a run a name; an empty name takes it away. */
  renameRun(id: string, title: string): Promise<Run>;
  /** The files a finished run wrote (a notebook job's reports and so on). */
  runResults(id: string, signal?: AbortSignal): Promise<ResultFile[]>;
  /** One of them as text, for showing it on the page. */
  resultText(id: string, name: string, signal?: AbortSignal): Promise<string>;
  /** Where the browser downloads one of them. */
  resultUrl(id: string, name: string): string;
}

const BASE = '/api/jobs';
const bad = () => new JobsApiError(502, 'The jobs service returned an unreadable response.');

export function createLiveApi(fetchImpl: typeof fetch = (...a) => fetch(...a)): JobsApi {
  async function call(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new JobsApiError(0, 'The jobs service could not be reached.');
    }
    const text = await res.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
    if (!res.ok) {
      const p = (payload ?? {}) as { error?: unknown; details?: unknown };
      const details = Array.isArray(p.details) ? p.details.filter((d): d is string => typeof d === 'string').slice(0, 20).map((d) => sanitizeText(d, 300)) : [];
      throw new JobsApiError(res.status, typeof p.error === 'string' ? sanitizeText(p.error, 300) : `Request failed (${res.status})`, details);
    }
    return payload;
  }
  const checkId = (id: string) => { if (!isRunId(id)) throw new JobsApiError(400, 'Invalid run id.'); };
  return {
    mode: 'live',
    async listRuns(q, signal) {
      const p = new URLSearchParams({ detail: q.detail ?? 'summary' });
      if (q.state) p.set('state', q.state);
      if (q.name_prefix) p.set('name_prefix', q.name_prefix);
      if (q.page_size) p.set('page_size', String(q.page_size));
      if (q.page_token) p.set('page_token', q.page_token);
      if (q.scope && q.scope !== 'all') p.set('scope', q.scope);
      return normalizeRunList(await call('GET', `/runs?${p}`, undefined, signal)) ?? (() => { throw bad(); })();
    },
    async getRun(id, detail, signal, steps) {
      checkId(id);
      const p = new URLSearchParams({ detail });
      for (const s of steps ?? []) { if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new JobsApiError(400, 'Invalid step.'); p.append('step', s); }
      return normalizeRun(await call('GET', `/runs/${encodeURIComponent(id)}?${p}`, undefined, signal)) ?? (() => { throw bad(); })();
    },
    async serviceInfo(signal) {
      return normalizeServiceInfo(sanitizeUntrusted(await call('GET', '/service-info', undefined, signal))) ?? {};
    },
    async storageSetup(signal) {
      return normalizeStorageSetup(await call('GET', '/storage-setup', undefined, signal)) ?? (() => { throw bad(); })();
    },
    async catalog(signal) {
      const c = sanitizeUntrusted(await call('GET', '/catalog', undefined, signal)) as Partial<CatalogResponse> | undefined;
      if (!c || typeof c.configured !== 'boolean' || !Array.isArray(c.jobs) || !Array.isArray(c.errors)) throw bad();
      return c as CatalogResponse;
    },
    async submitJob(req) {
      const r = (await call('POST', '/submit', req)) as { id?: unknown; warnings?: unknown } | undefined;
      if (!r || !isRunId(r.id)) throw bad();
      return { id: r.id, warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string').map((w) => sanitizeText(w, 300)) : [] };
    },
    async submitYaml(yaml, params, choices) {
      const r = (await call('POST', '/submit', { yaml, ...(params ? { params } : {}), ...(choices?.title ? { title: choices.title } : {}), ...(choices?.group ? { group: choices.group } : {}) })) as { id?: unknown; warnings?: unknown } | undefined;
      if (!r || !isRunId(r.id)) throw bad();
      return { id: r.id, warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string').map((w) => sanitizeText(w, 300)) : [] };
    },
    async checkYaml(yaml, params) {
      const r = (await call('POST', '/submit', { yaml, check: true, ...(params ? { params } : {}) })) as { name?: unknown; steps?: unknown; warnings?: unknown } | undefined;
      if (!r || typeof r.name !== 'string' || typeof r.steps !== 'number') throw bad();
      return { name: sanitizeText(r.name, 64), steps: r.steps, warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string').map((w) => sanitizeText(w, 300)) : [] };
    },
    async runResults(id, signal) {
      checkId(id);
      const r = (await call('GET', `/runs/${encodeURIComponent(id)}/results`, undefined, signal)) as { files?: unknown } | undefined;
      if (!r || !Array.isArray(r.files)) throw bad();
      return r.files
        .filter((f): f is { name: string; size: number } => !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string' && RESULT_NAME.test((f as { name: string }).name))
        .map((f) => ({ name: f.name, size: typeof f.size === 'number' ? f.size : 0 }));
    },
    async resultText(id, name, signal) {
      checkId(id);
      if (!RESULT_NAME.test(name)) throw new JobsApiError(400, 'Invalid file name.');
      let res: Response;
      try { res = await fetchImpl(`${BASE}/runs/${encodeURIComponent(id)}/results/${encodeURIComponent(name)}`, { credentials: 'same-origin', signal }); } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        throw new JobsApiError(0, 'The jobs service could not be reached.');
      }
      if (!res.ok) throw new JobsApiError(res.status, res.status === 404 ? 'No such result.' : `Request failed (${res.status})`);
      const text = await res.text();
      if (text.length > MAX_RESULT_TEXT) throw new JobsApiError(413, 'This file is too large to show; download it instead.');
      return text;
    },
    resultUrl(id, name) {
      checkId(id);
      if (!RESULT_NAME.test(name)) throw new JobsApiError(400, 'Invalid file name.');
      return `${BASE}/runs/${encodeURIComponent(id)}/results/${encodeURIComponent(name)}?download=1`;
    },
    async cancelRun(id) {
      checkId(id);
      await call('POST', `/runs/${encodeURIComponent(id)}:cancel`, {});
    },
    async groups(signal) {
      const r = (await call('GET', '/groups', undefined, signal)) as { groups?: unknown } | undefined;
      if (!r || !Array.isArray(r.groups)) throw bad();
      return r.groups.filter((g): g is string => typeof g === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(g)).slice(0, 8);
    },
    async renameRun(id, title) {
      checkId(id);
      return normalizeRun(await call('POST', `/runs/${encodeURIComponent(id)}:rename`, { title })) ?? (() => { throw bad(); })();
    },
  };
}

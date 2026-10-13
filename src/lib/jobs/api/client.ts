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

export interface RunsQuery { state?: RunState; name_prefix?: string; page_size?: number; page_token?: string; detail?: Detail }
export interface SubmitRequest { job: string; params: Record<string, string | number | boolean> }
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
  cancelRun(id: string): Promise<void>;
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
    async cancelRun(id) {
      checkId(id);
      await call('POST', `/runs/${encodeURIComponent(id)}:cancel`, {});
    },
  };
}

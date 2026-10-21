import { GEN3_GUPPY_API } from '@gen3/core';
import type { FilterClause, TimeWindow } from '../spec';
import { guppyClause } from '../spec-actions/snippets';
import { GatewayError, csrfHeader, forgetCsrf } from './gatewayGraph';

export type DownloadFormat = 'csv' | 'json';

export interface DownloadRequest {
  index_name: string;
  window: TimeWindow;
  filters: FilterClause[];
  columns: string[];
}

export interface DownloadResult {
  filename: string;
  /** Inline files arrive as text; large exports arrive as a link to a file the service prepared. */
  text?: string;
  url?: string;
  total: number | null;
  truncated: boolean;
}

const POLL_MS = 3000;
const POLL_TRIES = 200;
const NEEDS_UPDATE = 'The data service needs updating before the console can export from it.';

export async function downloadViaGateway(
  req: DownloadRequest,
  format: DownloadFormat,
  fetchImpl: typeof fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<DownloadResult> {
  const filter = { AND: [{ '>=': { event_time: req.window.start } }, { '<=': { event_time: req.window.end } }, ...req.filters.map(guppyClause)] };
  const headers = { 'content-type': 'application/json', ...(await csrfHeader(fetchImpl)) };
  const res = await fetchImpl(`${GEN3_GUPPY_API}/download`, {
    method: 'POST', credentials: 'same-origin', headers,
    body: JSON.stringify({ type: req.index_name, format, fields: req.columns, filter }),
  }).catch(() => { throw new GatewayError(0, 'The data service could not be reached.'); });
  if (res.status === 403) forgetCsrf();
  if (res.status === 403 && (await res.clone().text()).includes('personal-data')) throw new GatewayError(403, 'This export includes personal-data columns, which need PII access. Remove them and try again.');
  if (!res.ok) throw new GatewayError(res.status, `The export failed (${res.status}).`);
  if (res.headers.get('x-search-privacy') !== '1') throw new GatewayError(502, NEEDS_UPDATE);

  const text = await res.text();
  const started = (() => { try { const j = JSON.parse(text) as { status?: string; job_id?: string; estimated_rows?: number }; return j.status === 'async' ? j : null; } catch { return null; } })();
  if (!started?.job_id) {
    const returned = Number(res.headers.get('x-vectis-returned-rows') ?? NaN);
    const total = Number(res.headers.get('x-vectis-total-rows') ?? NaN);
    return {
      filename: `${req.index_name}_export.${format}`, text,
      total: Number.isFinite(total) ? total : null,
      truncated: res.headers.get('x-vectis-truncated') === 'true' || (Number.isFinite(returned) && Number.isFinite(total) && returned < total),
    };
  }
  for (let i = 0; i < POLL_TRIES; i += 1) {
    await wait(POLL_MS);
    const poll = await fetchImpl(`${GEN3_GUPPY_API}/jobs/${encodeURIComponent(started.job_id)}`, { credentials: 'same-origin', headers: await csrfHeader(fetchImpl) })
      .catch(() => { throw new GatewayError(0, 'The data service could not be reached.'); });
    if (!poll.ok) throw new GatewayError(poll.status, `Could not check the export (${poll.status}).`);
    const j = (await poll.json().catch(() => ({}))) as { status?: string; download_url?: string };
    if (j.status === 'DONE' && j.download_url) return { filename: `${req.index_name}_export.${format}`, url: j.download_url, total: started.estimated_rows ?? null, truncated: false };
    if (j.status === 'FAILED') throw new GatewayError(502, 'The export job failed.');
  }
  throw new GatewayError(504, 'The export is still running. Try again in a few minutes.');
}

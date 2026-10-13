import type { QuerySpec } from '../spec';
import { cleanSpec } from './validate';

/**
 * Open in notebook.
 *
 * The console writes the query spec to sessionStorage under NOTEBOOK_SPEC_STORAGE_KEY and navigates to /Workspaces.
 * sessionStorage is per tab and is cleared when the tab closes, and it never leaves the browser, so nothing is sent
 * anywhere. A notebook helper (or a workspace launcher) reads and deletes the key. The value is JSON:
 *
 *   { "version": 1, "kind": "vectis.query-spec", "created_at": "<ISO time>", "spec": { <QuerySpec> } }
 *
 * The spec holds the index, time window, filters, columns and sort. It never holds credentials or row data.
 */
export const NOTEBOOK_SPEC_STORAGE_KEY = 'vectis.notebook.query-spec';
export const NOTEBOOK_PATH = '/Workspaces';
const MAX_PAYLOAD_BYTES = 64 * 1024;

interface NotebookPayload {
  version: 1;
  kind: 'vectis.query-spec';
  created_at: string;
  spec: QuerySpec;
}

export function buildNotebookPayload(spec: QuerySpec, now: Date = new Date()): NotebookPayload {
  const payload: NotebookPayload = { version: 1, kind: 'vectis.query-spec', created_at: now.toISOString(), spec: cleanSpec(spec) };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_PAYLOAD_BYTES) throw new Error('The query is too large to hand to a notebook.');
  return payload;
}

interface NotebookDeps {
  storage: Pick<Storage, 'setItem'>;
  navigate: (path: string) => unknown;
  now?: Date;
}

/** Store the spec, then navigate. If storing fails (private mode, quota) it does NOT navigate, and says why. */
export function openInNotebook(spec: QuerySpec, deps: NotebookDeps): { ok: true } | { ok: false; error: string } {
  let json: string;
  try {
    json = JSON.stringify(buildNotebookPayload(spec, deps.now));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    deps.storage.setItem(NOTEBOOK_SPEC_STORAGE_KEY, json);
  } catch {
    return { ok: false, error: 'This browser would not let the console keep the query for the notebook.' };
  }
  void deps.navigate(NOTEBOOK_PATH);
  return { ok: true };
}

/**
 * How the portal keeps and reads the durable run history (history.ts) next to the workflow engine.
 *
 *  - A run is recorded when it is submitted, and its record is brought up to date whenever it is read (the list, and the run view once it has
 *    finished). A record is owned by a scope: the person, or the group the run was started for.
 *  - The Runs list is read from the records. It also imports a person's runs that the engine still holds and the history lacks (so runs started
 *    before the history existed are not lost), and refreshes the state of runs that were last seen unfinished.
 *  - Who may open a record is decided here, by the caller's own scope and the groups the portal has already checked with Arborist. The history
 *    service cannot tell users from one another.
 *  - If the engine no longer has a run, the saved summary is shown (marked archived) with its results; nothing here can bring the logs back.
 *
 * Writing the history is best effort: a run that started is never reported as failed because its record could not be saved, and the next list
 * repairs it. Reading falls back to the engine alone when no history is configured.
 */
import { hasControlChars } from '@/lib/safe-text';
import { groupScope, isGroupScope, personalScope, type HistoryClient, type HistoryRecord } from './history';
import { isTerminal, type Run, type RunList } from './model';
import { RunnerError, type Runner, type RunnerContext, type RunQuery } from './runner';

export type Scope = 'mine' | 'shared' | 'all';
export interface Flow { runner: Runner; history: HistoryClient | null; ctx: RunnerContext; now?: () => Date }

const LIVE_PAGE = 50;
const MAX_WRITES = 25;
const MAX_REFRESH = 10;
const TITLE_MAX = 80;

/** What is kept of a run: enough to list it and show it later, never logs, commands or anything large. Params are the non-secret ones the run was given. */
export function compact(run: Run): Run {
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(run.tags)) if (k.startsWith('vectis.')) tags[k] = v;
  return {
    ...run,
    steps: run.steps.slice(0, 64).map((s) => ({ ...s, command: [], stdout: '', stderr: '', truncated: false, image: '', logs_loaded: false })),
    inputs: [], outputs: [], system_logs: undefined, tags,
  };
}

const scopeOf = (run: Run, user: string): string => (run.group ? groupScope(run.group) : personalScope(user));
export const mayUse = (scope: string, ctx: Flow['ctx']): boolean =>
  isGroupScope(scope) ? (ctx.groups ?? []).includes(scope.slice(2)) : scope === personalScope(ctx.user);

/** A title a person typed: trimmed, one line, at most 80 characters; null when it is not acceptable. */
export function cleanTitle(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length > TITLE_MAX || hasControlChars(t)) return null;
  return t === '' ? undefined : t;
}

const save = async (f: Flow, scope: string, run: Run): Promise<void> => {
  if (!f.history) return;
  try { await f.history.put(scope, compact(run)); } catch { /* best effort: the next list repairs it */ }
};

/** After a successful submit. `title` and `group` are what the person chose; the rest is read back from the engine. */
export async function recordSubmitted(f: Flow, id: string, chosen: { title?: string; group?: string }): Promise<void> {
  if (!f.history) return;
  let run: Run;
  try { run = await f.runner.get(id, f.ctx, { detail: 'summary' }); } catch { return; }
  run = { ...run, ...(chosen.title ? { title: chosen.title } : {}), ...(chosen.group ? { group: chosen.group } : {}), created_at: run.created_at ?? (f.now ?? (() => new Date()))().toISOString() };
  await save(f, scopeOf(run, f.ctx.user), run);
}

const scopesFor = (f: Flow, scope: Scope): string[] => [
  ...(scope === 'shared' ? [] : [personalScope(f.ctx.user)]),
  ...(scope === 'mine' ? [] : (f.ctx.groups ?? []).map(groupScope)),
];

export async function listRuns(f: Flow, q: RunQuery, scope: Scope = 'all'): Promise<RunList> {
  if (!f.history) return f.runner.list(q, f.ctx);
  const scopes = scopesFor(f, scope);
  if (scopes.length === 0) return { runs: [], next_page_token: null };
  const limit = Math.min(q.page_size ?? 25, 50);
  const page = await f.history.list(scopes, q.page_token, limit);
  const byId = new Map<string, HistoryRecord>(page.records.map((r) => [r.run.id, r]));

  // Runs the engine still holds that the history lacks or has an older state for: written now (first page only).
  const live = new Map<string, Run>();
  if (!q.page_token) {
    try {
      for (const r of (await f.runner.list({ page_size: LIVE_PAGE }, f.ctx)).runs) live.set(r.id, r);
    } catch { /* the history alone is still a list */ }
    const writes: Array<Promise<void>> = [];
    for (const r of live.values()) {
      const have = byId.get(r.id);
      const mine = scopeOf(r, f.ctx.user);
      if (scope === 'mine' && isGroupScope(mine)) continue;
      if (scope === 'shared' && !isGroupScope(mine)) continue;
      if (!have || have.run.state !== r.state) {
        if (writes.length >= MAX_WRITES) break;
        const merged: Run = have ? { ...r, ...(have.run.title ? { title: have.run.title } : {}) } : r;
        writes.push(save(f, mine, merged));
        byId.set(r.id, { scope: mine, run: merged, saved_at: '' });
      }
    }
    await Promise.all(writes);
  }

  // Runs last seen unfinished that the page did not just show live: ask the engine; one it has forgotten is archived, not left "running" forever.
  const stale = page.records.filter((r) => !isTerminal(r.run.state) && !r.run.archived && !live.has(r.run.id)).slice(0, MAX_REFRESH);
  await Promise.all(stale.map(async (rec) => {
    let next: Run;
    try {
      next = { ...(await f.runner.get(rec.run.id, f.ctx, { detail: 'summary' })), ...(rec.run.title ? { title: rec.run.title } : {}) };
    } catch (e) {
      if (!(e instanceof RunnerError) || e.status !== 404) return;
      next = { ...rec.run, state: 'unknown', archived: true };
    }
    byId.set(rec.run.id, { ...rec, run: next });
    if (next.state !== rec.run.state) await save(f, rec.scope, next);
  }));

  let runs = page.records.map((r) => byId.get(r.run.id)?.run ?? r.run);
  // runs written just now from the engine that sort into this page by time
  if (!q.page_token) {
    const have = new Set(runs.map((r) => r.id));
    for (const rec of byId.values()) if (!have.has(rec.run.id)) runs.push(rec.run);
    runs.sort((a, b) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? '') || (a.id < b.id ? 1 : -1));
    runs = runs.slice(0, limit);
  }
  if (q.state) runs = runs.filter((r) => r.state === q.state);
  if (q.name_prefix !== undefined) {
    const p = q.name_prefix.toLowerCase();
    runs = runs.filter((r) => r.name.toLowerCase().startsWith(p) || (r.title ?? '').toLowerCase().includes(p));
  }
  for (let i = 0; i < (q.tag_key?.length ?? 0); i++) {
    const k = (q.tag_key as string[])[i];
    const v = q.tag_value?.[i];
    runs = runs.filter((r) => Object.prototype.hasOwnProperty.call(r.tags, k) && (v === undefined || r.tags[k] === v));
  }
  return { runs, next_page_token: page.next };
}

/** One run the caller may see: from the engine (with the saved name), or, if the engine has forgotten it, the saved summary marked archived. */
export async function openRun(f: Flow, id: string, opts?: { detail?: 'summary' | 'full'; steps?: string[] }): Promise<{ run: Run; scope: string | null }> {
  const saved = f.history ? f.history.get(id).catch(() => null) : Promise.resolve(null);
  let live: Run | null = null;
  let failure: unknown = null;
  try { live = await f.runner.get(id, f.ctx, opts); } catch (e) { failure = e; }
  const rec = await saved;
  if (live) {
    const scope = scopeOf(live, f.ctx.user);
    const run = rec?.run.title ? { ...live, title: rec.run.title } : live;
    // the record catches up once the run has finished (reads while it runs do not write: the list does that)
    if (f.history && isTerminal(live.state) && (!rec || rec.run.state !== live.state)) await save(f, rec?.scope ?? scope, run);
    return { run, scope: rec?.scope ?? scope };
  }
  if (rec && mayUse(rec.scope, f.ctx) && failure instanceof RunnerError && failure.status === 404) return { run: { ...rec.run, archived: true }, scope: rec.scope };
  throw failure ?? new RunnerError(404, 'Run not found.');
}

/** Give a run a name (or take it away with an empty title). Any member of the run's group may; a personal run only its owner. */
export async function renameRun(f: Flow, id: string, title: string | undefined): Promise<Run> {
  if (!f.history) throw new RunnerError(404, 'Not found.');
  const { run, scope } = await openRun(f, id, { detail: 'summary' });
  if (!scope || !mayUse(scope, f.ctx)) throw new RunnerError(404, 'Run not found.');
  const next: Run = { ...run, title };
  if (!title) delete (next as { title?: string }).title;
  await f.history.put(scope, compact(next));
  return next;
}

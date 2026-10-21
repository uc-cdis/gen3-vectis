/**
 * The /api/jobs/* request handlers, written once. The Next.js API routes (src/pages/api/jobs/*) are one-line wrappers that
 * call these with NO second argument, so production always runs with `realDeps`: the Gen3 login + Arborist gate
 * (authorizeJobs), the runner picked by JOBS_RUNNER, the GitHub catalog, and the same-origin check.
 *
 * `deps` is a test seam (handlers.deps.test.ts): a function parameter, not an environment switch or a flag, so nothing a
 * request or a deployment's environment can say replaces a dependency, and the Next routes never pass one (the same
 * pattern as authorize() in src/lib/siem/bff.ts).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { allowedJobGroups, authorizeJobProfile, authorizeJobs, sendFailure, writeAllowed as realWriteAllowed, type Access, type Level } from './portal';
import { CatalogError, activeSource, loadCatalog, publicCatalog } from './catalog/load';
import type { CatalogSource } from './catalog/source';
import { compileDagJob, compileJob } from './jobdef/compile';
import { compileAdhocDag } from './dagu/adhoc';
import { jobProfiles } from './dagu/profiles';
import { compileAdhocJob } from './jobdef/adhocJob';
import { isDagDef } from './jobdef/types';
import { usesUserBucket } from './jobdef/templates';
import { matchJobsRoute, parseRunQuery, routeLevel } from './routes';
import type { Runner } from './runner';
import { getRunner, runnerId } from './select';
import { parseRunId } from './dagu/map';
import { ResultNotFound, resultsClientFromEnv, type ResultsClient } from './results';
import { GROUP_NAME, historyClientFromEnv, type HistoryClient } from './history';
import { cleanTitle, listRuns, openRun, recordSubmitted, renameRun, type Flow } from './historyFlow';

export interface JobsDeps {
  /** who is calling, and may they (level 'read' = /Jobs, 'submit' = /Jobs/submit) */
  authorize(cookie: string | undefined, level: Level): Promise<Access>;
  /** may this user start jobs of an operator-defined profile (what the job pods run as)? */
  authorizeProfile(cookie: string | undefined, profile: string): Promise<Access>;
  /** the runner; throws RunnerConfigError (fail closed) */
  getRunner(): Runner;
  /** validates the runner selection without returning the runner */
  runnerId(): string;
  /** the catalog source, or null when none is configured; throws CatalogError on bad config */
  catalogSource(): CatalogSource | null;
  /** same-origin rule for writes */
  writeAllowed(req: NextApiRequest, method: string): boolean;
  /** where a run's result files are read from, or null when that is not configured */
  resultsClient(): ResultsClient | null;
  /** the groups this user may run as and see (Arborist, via authz.json); none when omitted */
  groups?(cookie: string | undefined): Promise<string[]>;
  /** the durable run history, or null when that is not configured (then the engine's own list is used) */
  history?(): HistoryClient | null;
}

// Looked up at call time (not captured) so a test that mocks './portal' still takes effect.
export const realDeps = (): JobsDeps => ({
  authorize: (cookie, level) => authorizeJobs(cookie, level),
  authorizeProfile: (cookie, profile) => authorizeJobProfile(cookie, profile),
  getRunner: () => getRunner(),
  runnerId: () => runnerId(),
  catalogSource: () => activeSource(),
  writeAllowed: (req, method) => realWriteAllowed(req, method),
  resultsClient: () => resultsClientFromEnv(),
  groups: (cookie) => allowedJobGroups(cookie),
  history: () => historyClientFromEnv(),
});

/** GET runs, runs/{id}, service-info, storage-setup; POST runs/{id}:cancel. Everything else is 404 before auth. */
export async function handleRuns(req: NextApiRequest, res: NextApiResponse, deps: JobsDeps = realDeps()): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const method = req.method ?? '';
  const route = matchJobsRoute(method, req.query.route);
  if (!route) { res.status(404).json({ error: 'Not found.' }); return; }
  const q = parseRunQuery(route, req.query);
  if (!q.ok) { res.status(400).json({ error: q.error }); return; }
  if (!deps.writeAllowed(req, method)) { res.status(403).json({ error: 'Cross-site request refused.' }); return; }

  const access = await deps.authorize(req.headers.cookie, routeLevel(route));
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  try {
    const runner = deps.getRunner();
    // The history and groups belong to the workflow runner; with another runner the run list is that runner's own, as before.
    const groups = runner.id === 'dagu' && deps.groups ? await deps.groups(req.headers.cookie).catch(() => []) : [];
    const ctx = runner.id === 'dagu' ? { user: access.user, token: access.token, groups } : { user: access.user, token: access.token };
    const flow: Flow = { runner, history: runner.id === 'dagu' && deps.history ? deps.history() : null, ctx };
    switch (route.kind) {
      case 'list': res.status(200).json(await listRuns(flow, q.query, q.query.scope ?? 'all')); return;
      case 'get': res.status(200).json((await openRun(flow, route.id, { detail: q.query.detail, steps: q.query.steps })).run); return;
      case 'cancel': await runner.cancel(route.id, ctx); res.status(200).json({}); return;
      case 'groups': res.status(200).json({ groups }); return;
      case 'rename': {
        const body = req.body as { title?: unknown } | null;
        if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json') || !body || typeof body !== 'object') { res.status(415).json({ error: 'JSON required.' }); return; }
        const title = cleanTitle(body.title);
        if (title === null) { res.status(400).json({ error: 'A name is one line of at most 80 characters.' }); return; }
        res.status(200).json(await renameRun(flow, route.id, title)); return;
      }
      case 'service-info': res.status(200).json((await runner.info(ctx)) ?? {}); return;
      case 'results':
      case 'result-file': {
        // What a finished run wrote. Only the Dagu runner has results, and only the run's owner may read them: the runner's own
        // run lookup (the same one behind the run view) answers 404 for a run that is not yours, before anything is read.
        const results = runner.id === 'dagu' ? deps.resultsClient() : null;
        const ids = parseRunId(route.id);
        if (!results || !ids) { res.status(404).json({ error: 'Results are not available for this run.' }); return; }
        await openRun(flow, route.id, { detail: 'summary' }); // the saved summary counts too: results outlive the workflow server's copy of the run
        try {
          if (route.kind === 'results') { res.status(200).json({ files: await results.list(ids.dagRunId) }); return; }
          const body = await results.file(ids.dagRunId, route.name);
          const download = req.query.download === '1';
          // Notebook output is not trusted content: it is never served as a page of this site.
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
          res.setHeader('Content-Type', download ? 'application/octet-stream' : 'text/plain; charset=utf-8');
          if (download) res.setHeader('Content-Disposition', `attachment; filename="${route.name}"`);
          res.status(200).send(body);
        } catch (e) {
          if (e instanceof ResultNotFound) res.status(404).json({ error: 'No such result.' });
          else res.status(502).json({ error: 'Results are unavailable right now.' });
        }
        return;
      }
      case 'storage-setup': {
        if (!runner.storageSetup) { res.status(404).json({ error: 'Not found.' }); return; }
        const s = await runner.storageSetup(ctx);
        if (s) res.status(200).json(s); else res.status(404).json({ error: 'Not found.' });
        return;
      }
    }
  } catch (e) {
    sendFailure(res, e);
  }
}

/** GET /api/jobs/catalog: job definitions from the configured source, pinned to one version. Read-only; same gate as /Jobs. */
export async function handleCatalog(req: NextApiRequest, res: NextApiResponse, deps: JobsDeps = realDeps()): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  const access = await deps.authorize(req.headers.cookie, 'read');
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  try { deps.runnerId(); } catch (e) { sendFailure(res, e); return; }
  try {
    res.status(200).json(publicCatalog(await loadCatalog(deps.catalogSource())));
  } catch (e) {
    res.status(e instanceof CatalogError ? 502 : 500).json({ error: e instanceof CatalogError ? e.message : 'The catalog is unavailable.' });
  }
}

/**
 * POST /api/jobs/submit  { job: "<id>", params: { ... } }
 * Compiles the catalog definition ON THE SERVER (so vectis.job / vectis.catalog_* tags cannot be forged), fills
 * {{user_bucket}} from the runner's storage setup (a runner without one refuses such jobs), and hands the neutral
 * LaunchSpec to the selected runner. Needs /Jobs/submit.
 */
export async function handleSubmit(req: NextApiRequest, res: NextApiResponse, deps: JobsDeps = realDeps()): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!deps.writeAllowed(req, 'POST')) { res.status(403).json({ error: 'Cross-site request refused.' }); return; }
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { res.status(415).json({ error: 'JSON required.' }); return; }
  const access = await deps.authorize(req.headers.cookie, 'submit');
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  let runner: Runner;
  try { runner = deps.getRunner(); } catch (e) { sendFailure(res, e); return; } // an unknown JOBS_RUNNER fails closed before anything else
  const groups = runner.id === 'dagu' && deps.groups ? await deps.groups(req.headers.cookie).catch(() => []) : [];
  const ctx = runner.id === 'dagu' ? { user: access.user, token: access.token, groups } : { user: access.user, token: access.token };
  const flow: Flow = { runner, history: runner.id === 'dagu' && deps.history ? deps.history() : null, ctx };

  const b = req.body as { job?: unknown; params?: unknown; yaml?: unknown; check?: unknown; group?: unknown; title?: unknown } | null;
  // What the person chose besides the job: a name for the run, and a group to run it as (then the group owns it and every member sees it).
  const title = cleanTitle(b?.title);
  if (title === null) { res.status(400).json({ error: 'A name is one line of at most 80 characters.' }); return; }
  let group: string | undefined;
  if (b && b.group !== undefined && b.group !== null && b.group !== '') {
    if (runner.id !== 'dagu') { res.status(400).json({ error: 'Running as a group needs the workflow runner.' }); return; }
    if (typeof b.group !== 'string' || !GROUP_NAME.test(b.group) || !groups.includes(b.group)) { res.status(403).json({ error: 'You are not in that group.' }); return; }
    group = b.group;
  }
  const chosen = { ...(title ? { title } : {}), ...(group ? { group } : {}) };
  // A pasted workflow needs no catalog, so it works while the catalog source is down. Same gate (/Jobs/submit), same lint.
  if (b && typeof b === 'object' && b.yaml !== undefined) {
    if ((process.env.JOBS_ALLOW_PASTE ?? '').trim().toLowerCase() === 'no') { res.status(403).json({ error: 'Pasting a workflow or job is turned off on this server.' }); return; }
    const params = b.params !== undefined && typeof b.params === 'object' && b.params !== null && !Array.isArray(b.params) ? (b.params as Record<string, unknown>) : {};
    // Dagu runs a pasted workflow definition; TES runs a pasted container job in the catalog's job format. Same lint and compiler as the catalog path.
    let c;
    try {
      c = runner.id === 'dagu'
        ? compileAdhocDag(b.yaml)
        : await compileAdhocJob(b.yaml, params, async () => (runner.storageSetup ? (await runner.storageSetup(ctx))?.bucket ?? undefined : undefined));
    } catch (e) { sendFailure(res, e); return; }
    if (!c.ok) { res.status(400).json({ error: 'The definition was refused.', details: c.errors }); return; }
    if (b.check === true) { res.status(200).json({ ok: true, name: c.name, steps: c.steps, runner: runner.id, warnings: c.spec.warnings }); return; }
    try {
      const out = await runner.submit(c.spec, ctx, group ? { group } : undefined);
      await recordSubmitted(flow, out.id, chosen);
      console.info(JSON.stringify({ action: 'jobs_adhoc_submit', runner: runner.id, user: ctx.user, definition_sha256: c.sha, run: out.id }));
      res.status(200).json(out);
    } catch (e) { sendFailure(res, e); }
    return;
  }
  if (!b || typeof b !== 'object' || typeof b.job !== 'string' || (b.params !== undefined && (typeof b.params !== 'object' || b.params === null || Array.isArray(b.params)))) {
    res.status(400).json({ error: 'Expected { job, params }.' }); return;
  }
  let catalog;
  try { catalog = await loadCatalog(deps.catalogSource()); } catch (e) { res.status(e instanceof CatalogError ? 502 : 500).json({ error: 'The catalog is unavailable.' }); return; }
  const entry = catalog.jobs.find((j) => j.def.id === b.job);
  if (!catalog.configured || !entry || !catalog.repo || !catalog.sha) { res.status(404).json({ error: 'Unknown job.' }); return; }

  try {
    const params = (b.params ?? {}) as Record<string, unknown>;
    const version = { repo: catalog.repo, sha: catalog.sha };
    let c;
    if (isDagDef(entry.def)) {
      // a workflow-engine job: the engine's native definition (read from the same commit at catalog load) is passed through
      if (!entry.native) { res.status(500).json({ error: 'The catalog entry is incomplete.' }); return; }
      // A profile decides what the job pods run as (an AWS role, the user's own Gen3 token). The reviewed catalog entry names it; this
      // server must offer it, and the user needs the profile's own permission on top of /Jobs/submit.
      if (entry.def.profile) {
        if (!jobProfiles().has(entry.def.profile)) { res.status(400).json({ error: 'This job needs a profile that this server does not offer.' }); return; }
        const allowed = await deps.authorizeProfile(req.headers.cookie, entry.def.profile);
        if (!allowed.ok) { res.status(allowed.status === 401 ? 401 : 403).json({ error: `You are not allowed to run jobs that use the ${entry.def.profile} profile.` }); return; }
      }
      c = compileDagJob(entry.def, entry.native, params, version);
    } else {
      let userBucket: string | undefined;
      if (usesUserBucket(entry.def)) {
        if (!runner.storageSetup) { res.status(400).json({ error: 'This job needs a personal storage bucket, which the active jobs runner does not provide.' }); return; }
        userBucket = (await runner.storageSetup(ctx))?.bucket ?? undefined;
      }
      c = compileJob(entry.def, params, { ...version, userBucket });
    }
    if (!c.ok) { res.status(400).json({ error: 'The parameters were refused.', details: c.errors }); return; }
    const out = await runner.submit(c.spec, ctx, group ? { group } : undefined);
    await recordSubmitted(flow, out.id, chosen);
    res.status(200).json(out);
  } catch (e) {
    sendFailure(res, e);
  }
}

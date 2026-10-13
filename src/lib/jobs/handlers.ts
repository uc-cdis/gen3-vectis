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
import { authorizeJobs, sendFailure, writeAllowed as realWriteAllowed, type Access, type Level } from './portal';
import { CatalogError, activeSource, loadCatalog, publicCatalog } from './catalog/load';
import type { CatalogSource } from './catalog/source';
import { compileDagJob, compileJob } from './jobdef/compile';
import { isDagDef } from './jobdef/types';
import { usesUserBucket } from './jobdef/templates';
import { matchJobsRoute, parseRunQuery, routeLevel } from './routes';
import type { Runner } from './runner';
import { getRunner, runnerId } from './select';

export interface JobsDeps {
  /** who is calling, and may they (level 'read' = /Jobs, 'submit' = /Jobs/submit) */
  authorize(cookie: string | undefined, level: Level): Promise<Access>;
  /** the runner; throws RunnerConfigError (fail closed) */
  getRunner(): Runner;
  /** validates the runner selection without returning the runner */
  runnerId(): string;
  /** the catalog source, or null when none is configured; throws CatalogError on bad config */
  catalogSource(): CatalogSource | null;
  /** same-origin rule for writes */
  writeAllowed(req: NextApiRequest, method: string): boolean;
}

// Looked up at call time (not captured) so a test that mocks './portal' still takes effect.
export const realDeps = (): JobsDeps => ({
  authorize: (cookie, level) => authorizeJobs(cookie, level),
  getRunner: () => getRunner(),
  runnerId: () => runnerId(),
  catalogSource: () => activeSource(),
  writeAllowed: (req, method) => realWriteAllowed(req, method),
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
  const ctx = { user: access.user, token: access.token };

  try {
    const runner = deps.getRunner();
    switch (route.kind) {
      case 'list': res.status(200).json(await runner.list(q.query, ctx)); return;
      case 'get': res.status(200).json(await runner.get(route.id, ctx, { detail: q.query.detail, steps: q.query.steps })); return;
      case 'cancel': await runner.cancel(route.id, ctx); res.status(200).json({}); return;
      case 'service-info': res.status(200).json((await runner.info(ctx)) ?? {}); return;
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
  const ctx = { user: access.user, token: access.token };
  let runner: Runner;
  try { runner = deps.getRunner(); } catch (e) { sendFailure(res, e); return; } // an unknown JOBS_RUNNER fails closed before anything else

  const b = req.body as { job?: unknown; params?: unknown } | null;
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
    res.status(200).json(await runner.submit(c.spec, ctx));
  } catch (e) {
    sendFailure(res, e);
  }
}

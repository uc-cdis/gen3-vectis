/**
 * The seam between the portal and whatever executes a job. The portal handlers (src/pages/api/jobs/*) authorize the
 * user, pick ONE runner from JOBS_RUNNER (select.ts) and call it; they know nothing about TES or Batch. A runner is server-side only.
 *
 * Contract every runner MUST keep:
 *  - ctx.user is the portal-VERIFIED identity and ctx.token the user's own bearer; neither ever comes from the browser.
 *  - submit() stamps `vectis.submitted_by = ctx.user` itself and drops any other client-looking `vectis.*` tag.
 *  - list/get/cancel return or touch only runs the user may see (the backend enforces it, or the runner does).
 *  - Credentials: a runner acts with the USER's credentials, or the remote server enforces ownership itself. Never portal-held cloud IAM.
 *  - Failures are thrown as RunnerError (a public, already-sanitised message); nothing else leaks.
 */
import type { LaunchSpec } from './launch';
import type { Detail, Run, RunList, RunState, ServiceInfo, StorageSetup } from './model';

export interface RunnerContext {
  user: string;
  token: string;
  /** the groups the portal has already checked this user is in (Arborist); a group run is theirs to see and cancel only for these */
  groups?: readonly string[];
}
/** What a person chose when starting a run. `group` must be one of ctx.groups. */
export interface SubmitOptions { group?: string }

export interface RunQuery {
  state?: RunState;
  name_prefix?: string;
  tag_key?: string[];
  tag_value?: string[];
  page_size?: number;
  page_token?: string;
  /** whose runs: your own, the groups', or both (default) */
  scope?: 'mine' | 'shared' | 'all';
  /** summary = no logs (list default); full = with logs (get default) */
  detail?: Detail;
  /** get only: fetch logs for exactly these steps (a workflow runner otherwise fetches them for failed/running steps only) */
  steps?: string[];
}

export interface Runner {
  readonly id: string;
  submit(spec: LaunchSpec, ctx: RunnerContext, opts?: SubmitOptions): Promise<{ id: string; warnings: string[] }>;
  list(query: RunQuery, ctx: RunnerContext): Promise<RunList>;
  get(id: string, ctx: RunnerContext, opts?: { detail?: Detail; steps?: string[] }): Promise<Run>;
  cancel(id: string, ctx: RunnerContext): Promise<void>;
  info(ctx: RunnerContext): Promise<ServiceInfo | null>;
  /** Optional: the caller's personal storage (for the `{{user_bucket}}` placeholder). A runner without it cannot run jobs that use it. */
  storageSetup?(ctx: RunnerContext): Promise<StorageSetup | null>;
}

/** A failure with a message that is safe to show. `status` is the HTTP status the portal answers with. */
export class RunnerError extends Error {
  constructor(public readonly status: number, message: string, public readonly details: string[] = []) {
    super(message);
    this.name = 'RunnerError';
  }
}
/** JOBS_RUNNER is set to something that is not a runner. Fail closed: nothing is served. */
export class RunnerConfigError extends Error {
  constructor(message = 'JOBS_RUNNER is not a known runner') {
    super(message);
    this.name = 'RunnerConfigError';
  }
}

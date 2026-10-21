import type { LaunchSpec } from '../launch';
/** Catalog job definition (YAML file in the catalog). Runner-neutral: compiles to one LaunchSpec, which a runner maps to its own job. */
type ParamType = 'string' | 'integer' | 'number' | 'boolean' | 'enum' | 's3_url' | 'http_url' | 'secret';
type ParamValue = string | number | boolean;
export interface JobParam {
  name: string;
  label: string;
  description?: string;
  type: ParamType;
  required?: boolean;
  default?: ParamValue;
  values?: string[]; // enum choices
  pattern?: string; // anchored (^...$), max 128 chars, string params only
  min?: number;
  max?: number;
  max_length?: number;
  allow_leading_dash?: boolean;
  /** `secret` params only (workflow jobs): the environment variable the job pod receives the value in. The value is never a parameter. */
  env?: string;
}
interface JobInput { name: string; description?: string; url: string; path: string; type?: 'FILE' | 'DIRECTORY' }
interface JobOutput { name: string; description?: string; url: string; path: string; path_prefix?: string; type?: 'FILE' | 'DIRECTORY' }
interface JobExecutorExtra { image: string; command: string[]; env?: Record<string, string>; workdir?: string }
export interface JobDef {
  schema_version: 1;
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  image: string;
  command: string[];
  env?: Record<string, string>; // literal or secret://<name>
  params?: JobParam[];
  inputs?: JobInput[];
  outputs?: JobOutput[];
  resources?: { cpu_cores?: number; ram_gb?: number; disk_gb?: number; preemptible?: boolean };
  executors_after?: JobExecutorExtra[];
  secrets?: string[];
  timeout_seconds?: number;
  owner?: string;
}
export interface CompileContext {
  repo: string; // owner/name of the catalog
  sha: string; // catalog version id (commit SHA, or S3 version id)
  /** Bucket from the validated /storage/setup response. Required only if the def uses {{user_bucket}}. */
  userBucket?: string;
}
export interface LintIssue { path: string; message: string }
export type ParseResult = { ok: true; def: JobDef } | { ok: false; errors: string[] };
export type CompileResult = { ok: true; spec: LaunchSpec } | { ok: false; errors: string[] };

/** Catalog entry for a workflow-engine job (`kind: dag`). The native definition is read from `definition` in the same commit. */
export interface DagStepInfo { name: string; depends_on: string[]; executor: string }
export interface DagJobDef {
  schema_version: 1;
  kind: 'dag';
  engine: 'dagu';
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  definition: string;
  /** what the job runs AS (a service account, optionally the user's own Gen3 token): an operator-defined profile name (dagu/profiles.ts) */
  profile?: string;
  params?: JobParam[];
  owner?: string;
  /** filled by the catalog loader from the linted native file (not part of the YAML): the graph for display */
  graph?: DagStepInfo[];
}
/** What a catalog holds: a container job or a workflow-engine job. */
export type CatalogDef = JobDef | DagJobDef;
export const isDagDef = (d: CatalogDef): d is DagJobDef => (d as DagJobDef).kind === 'dag';
export type DagParseResult = { ok: true; def: DagJobDef } | { ok: false; errors: string[] };

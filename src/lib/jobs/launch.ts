/**
 * The runner-neutral launch spec: what the catalog compiler produces and what every Runner accepts.
 * It carries no runner vocabulary (no TES task, no runner-specific job definition). `toTesTask` (tes/adapter.ts) is the TES view of it.
 */
export interface LaunchStep { image: string; command: string[]; env?: Record<string, string>; workdir?: string }
interface LaunchInput { name: string; description?: string; url: string; path: string; type: 'FILE' | 'DIRECTORY' }
interface LaunchOutput { name: string; description?: string; url: string; path: string; path_prefix?: string; type: 'FILE' | 'DIRECTORY' }
interface LaunchResources { cpu_cores?: number; ram_gb?: number; disk_gb?: number; preemptible?: boolean }
/** A workflow-engine job: the engine's NATIVE definition passed through unchanged, plus the validated parameter values. Runners that cannot run it must refuse (never guess). */
interface LaunchDag {
  engine: 'dagu';
  /** the native definition text exactly as it is in the catalog commit (already linted at catalog load; a runner lints it again) */
  definition: string;
  /** name the native definition declares (or the job id when it declares none) */
  dag_name: string;
  /** param name -> value, every value already passed checkParam and the strict charset for DAG params */
  params: Record<string, string>;
  /** operator-defined profile the catalog entry asked for (what the job pods run as); the runner checks it against its own table */
  profile?: string;
  /** values the job pod receives as environment variables, entered by the user for this run only (`secret` params). They are never in `params`, the command, a label or a log. */
  secret_env?: Array<{ name: string; value: string }>;
}
export interface LaunchSpec {
  name: string;
  description?: string;
  /** set for `kind: dag` jobs; then `steps` is empty */
  dag?: LaunchDag;
  steps: LaunchStep[];
  inputs: LaunchInput[];
  outputs: LaunchOutput[];
  resources?: LaunchResources;
  /** `vectis.job`, `vectis.catalog_sha`, `vectis.catalog_repo` (the runner adds `vectis.submitted_by` from the verified user) */
  tags: Record<string, string>;
  /** names the definition declared in secrets[]; a runner may only resolve these */
  secrets: string[];
  warnings: string[];
}

/**
 * GA4GH TES v1.1.0 types. Two shapes exist on purpose:
 *  - TesTaskSubmission: what we SEND (no id/state/logs/creation_time; those are server-owned).
 *  - TesTask: what we RENDER, always produced by normalizeTask() from untrusted wire data.
 */
export const TES_STATES = [
  'UNKNOWN', 'QUEUED', 'INITIALIZING', 'RUNNING', 'PAUSED', 'COMPLETE',
  'EXECUTOR_ERROR', 'SYSTEM_ERROR', 'CANCELED', 'PREEMPTED', 'CANCELING',
] as const;
export type TesState = (typeof TES_STATES)[number];

type TesFileType = 'FILE' | 'DIRECTORY';

export interface TesExecutor {
  image: string;
  command: string[];
  workdir?: string;
  stdin?: string;
  stdout?: string;
  stderr?: string;
  env?: Record<string, string>;
  ignore_error?: boolean;
}
export interface TesInput {
  name?: string;
  description?: string;
  url?: string;
  path: string;
  type?: TesFileType;
  content?: string;
  streamable?: boolean;
}
export interface TesOutput {
  name?: string;
  description?: string;
  url: string;
  path: string;
  path_prefix?: string;
  type?: TesFileType;
}
export interface TesResources {
  cpu_cores?: number;
  preemptible?: boolean;
  ram_gb?: number;
  disk_gb?: number;
  zones?: string[];
  backend_parameters?: Record<string, string>;
  backend_parameters_strict?: boolean;
}
export interface TesTaskSubmission {
  name?: string;
  description?: string;
  inputs?: TesInput[];
  outputs?: TesOutput[];
  resources?: TesResources;
  executors: TesExecutor[];
  volumes?: string[];
  tags?: Record<string, string>;
}

// ---- normalised (render-safe) shapes ----
export interface TesExecutorLog {
  start_time: string | null;
  end_time: string | null;
  stdout: string;
  stderr: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  exit_code: number | null;
}
export interface TesOutputFileLog { url: string; path: string; size_bytes: string | null }
export interface TesTaskLog {
  logs: TesExecutorLog[];
  outputs: TesOutputFileLog[];
  metadata: Record<string, string>;
  start_time: string | null;
  end_time: string | null;
  system_logs: string[];
}
export interface TesTask {
  id: string;
  state: TesState;
  name: string;
  description: string;
  inputs: TesInput[];
  outputs: TesOutput[];
  resources: TesResources | null;
  executors: TesExecutor[];
  volumes: string[];
  tags: Record<string, string>;
  logs: TesTaskLog[];
  creation_time: string | null;
}
export interface TesTaskList { tasks: TesTask[]; next_page_token: string | null }

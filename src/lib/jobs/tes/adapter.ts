/**
 * The two pure seams between the neutral model and GA4GH TES:
 *  - toTesTask(spec): LaunchSpec -> the tesTask that is sent (key order is part of the contract; tests pin it).
 *  - fromTesTask(task): normalised TesTask -> Run, what the UI renders.
 */
import type { LaunchSpec } from '../launch';
import type { Run, RunState } from '../model';
import type { TesExecutor, TesState, TesTask, TesTaskSubmission } from './types';

export function toTesTask(spec: LaunchSpec): TesTaskSubmission {
  const executors: TesExecutor[] = spec.steps.map((s) => ({
    image: s.image, command: [...s.command], ...(s.env ? { env: { ...s.env } } : {}), ...(s.workdir ? { workdir: s.workdir } : {}),
  }));
  return {
    name: spec.name,
    ...(spec.description ? { description: spec.description } : {}),
    executors,
    ...(spec.inputs.length ? { inputs: spec.inputs.map((x) => ({ name: x.name, ...(x.description ? { description: x.description } : {}), url: x.url, path: x.path, type: x.type })) } : {}),
    ...(spec.outputs.length ? { outputs: spec.outputs.map((x) => ({ name: x.name, ...(x.description ? { description: x.description } : {}), url: x.url, path: x.path, ...(x.path_prefix ? { path_prefix: x.path_prefix } : {}), type: x.type })) } : {}),
    ...(spec.resources ? { resources: { ...spec.resources } } : {}),
    tags: { ...spec.tags },
  };
}

/** TES state -> neutral state. PAUSED and CANCELING stay "running" (the raw word is kept in backend_state). */
export const TES_TO_RUN_STATE: Record<TesState, RunState> = {
  UNKNOWN: 'unknown', QUEUED: 'queued', INITIALIZING: 'starting', RUNNING: 'running', PAUSED: 'running', COMPLETE: 'succeeded',
  EXECUTOR_ERROR: 'failed', SYSTEM_ERROR: 'failed', PREEMPTED: 'failed', CANCELED: 'cancelled', CANCELING: 'running',
};
/** Every TES state that maps to a neutral state (used to filter a list by neutral state). */
export const tesStatesFor = (s: RunState): TesState[] => (Object.keys(TES_TO_RUN_STATE) as TesState[]).filter((k) => TES_TO_RUN_STATE[k] === s);

export function fromTesTask(t: TesTask): Run {
  const log = t.logs[0];
  const sizes = new Map((log?.outputs ?? []).map((o) => [o.url, o.size_bytes] as const));
  const size = (url: string): number | null => {
    const s = sizes.get(url);
    if (!s) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null; // never a rounded number, never 0 for "unknown"
  };
  return {
    id: t.id,
    backend: 'tes',
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    job: t.tags['vectis.job'] ?? null,
    submitted_by: t.tags['vectis.submitted_by'] ?? null,
    state: TES_TO_RUN_STATE[t.state],
    backend_state: t.state,
    created_at: t.creation_time,
    started_at: log?.start_time ?? null,
    ended_at: log?.end_time ?? null,
    steps: t.executors.map((x, i) => {
      const l = log?.logs[i];
      return {
        index: i, name: '', depends_on: [], state: null, error: null, logs_loaded: true, image: x.image, command: x.command,
        exit_code: l?.exit_code ?? null, started_at: l?.start_time ?? null, ended_at: l?.end_time ?? null,
        stdout: l?.stdout ?? '', stderr: l?.stderr ?? '', truncated: !!(l?.stdout_truncated || l?.stderr_truncated),
      };
    }),
    inputs: t.inputs.map((i) => ({ name: i.name ?? '', url: i.url ?? null, path: i.path })),
    outputs: t.outputs.map((o) => ({ name: o.name ?? '', url: o.url, path: o.path, size_bytes: size(o.url) })),
    resources: t.resources ? { cpu_cores: t.resources.cpu_cores, ram_gb: t.resources.ram_gb, disk_gb: t.resources.disk_gb, preemptible: t.resources.preemptible } : null,
    tags: t.tags,
    system_logs: log?.system_logs ?? [],
  };
}

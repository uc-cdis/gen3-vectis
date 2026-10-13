import { TES_STATES } from './types';
import type { TesExecutor, TesExecutorLog, TesInput, TesOutput, TesOutputFileLog, TesResources, TesState, TesTask, TesTaskList, TesTaskLog } from './types';
import { isRunId, normalizeTime, strMap } from '../model';
import { sanitizeLabel, sanitizeLogText, sanitizeText } from '@/lib/safe-text';
import { isObj } from '@/lib/jobs/model';
import type { Obj } from '@/lib/jobs/model';

const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const objs = (v: unknown, max: number): Obj[] => list(v, max).filter(isObj);
const isTaskId = isRunId;
/** int64 arrives as a string (or a number); keep it as a decimal string so nothing is rounded. */
export function normalizeSize(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{1,19}$/.test(v)) return v.replace(/^0+(?=\d)/, '');
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  return null;
}
const normalizeState = (v: unknown): TesState => (typeof v === 'string' && (TES_STATES as readonly string[]).includes(v) ? (v as TesState) : 'UNKNOWN');

const optStr = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? sanitizeLabel(v, max) : undefined);
const type = (v: unknown): 'FILE' | 'DIRECTORY' | undefined => (v === 'FILE' || v === 'DIRECTORY' ? v : undefined);

function execLog(x: Obj): TesExecutorLog {
  const o = sanitizeLogText(x.stdout);
  const e = sanitizeLogText(x.stderr);
  return {
    start_time: normalizeTime(x.start_time), end_time: normalizeTime(x.end_time),
    stdout: o.text, stderr: e.text, stdout_truncated: o.truncated, stderr_truncated: e.truncated,
    exit_code: typeof x.exit_code === 'number' && Number.isInteger(x.exit_code) ? x.exit_code : null,
  };
}
function taskLog(x: Obj): TesTaskLog {
  return {
    logs: objs(x.logs, 64).map(execLog),
    outputs: objs(x.outputs, 256).map((o): TesOutputFileLog => ({ url: sanitizeLabel(o.url, 2048), path: sanitizeLabel(o.path, 1024), size_bytes: normalizeSize(o.size_bytes) })),
    metadata: strMap(x.metadata, 64, 1024),
    start_time: normalizeTime(x.start_time), end_time: normalizeTime(x.end_time),
    system_logs: list(x.system_logs, 256).filter((s): s is string => typeof s === 'string').map((s) => sanitizeText(s, 4096)),
  };
}

/** Coerce a task from the wire into a safe typed object. Returns null if it is not a task with a usable id. */
export function normalizeTask(raw: unknown): TesTask | null {
  if (!isObj(raw) || !isTaskId(raw.id)) return null;
  const inputs: TesInput[] = objs(raw.inputs, 64).map((i) => ({
    name: optStr(i.name, 256), description: optStr(i.description, 1024), url: optStr(i.url, 2048), path: sanitizeLabel(i.path, 1024),
    type: type(i.type), content: typeof i.content === 'string' ? sanitizeText(i.content) : undefined, streamable: typeof i.streamable === 'boolean' ? i.streamable : undefined,
  }));
  const outputs: TesOutput[] = objs(raw.outputs, 64).map((o) => ({
    name: optStr(o.name, 256), description: optStr(o.description, 1024), url: sanitizeLabel(o.url, 2048), path: sanitizeLabel(o.path, 1024),
    path_prefix: optStr(o.path_prefix, 1024), type: type(o.type),
  }));
  const executors: TesExecutor[] = objs(raw.executors, 64).map((x) => ({
    image: sanitizeLabel(x.image, 512),
    command: list(x.command, 256).filter((s): s is string => typeof s === 'string').map((s) => sanitizeText(s, 4096)),
    workdir: optStr(x.workdir, 1024), ignore_error: typeof x.ignore_error === 'boolean' ? x.ignore_error : undefined,
    // env values can carry secrets that a backend echoes back; never render them
    env: isObj(x.env) ? Object.fromEntries(Object.keys(x.env).slice(0, 64).filter((k) => k !== '__proto__').map((k) => [sanitizeLabel(k, 128), '[hidden]'])) : undefined,
  }));
  let resources: TesResources | null = null;
  if (isObj(raw.resources)) {
    const r = raw.resources;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    resources = { cpu_cores: n(r.cpu_cores), ram_gb: n(r.ram_gb), disk_gb: n(r.disk_gb), preemptible: typeof r.preemptible === 'boolean' ? r.preemptible : undefined,
      zones: list(r.zones, 8).filter((s): s is string => typeof s === 'string').map((s) => sanitizeLabel(s, 64)) };
  }
  return {
    id: raw.id, state: normalizeState(raw.state), name: sanitizeLabel(raw.name, 256), description: sanitizeText(raw.description, 4096),
    inputs, outputs, resources, executors,
    volumes: list(raw.volumes, 16).filter((s): s is string => typeof s === 'string').map((s) => sanitizeLabel(s, 1024)),
    tags: strMap(raw.tags, 64), logs: objs(raw.logs, 16).map(taskLog), creation_time: normalizeTime(raw.creation_time),
  };
}

export function normalizeTaskList(raw: unknown): TesTaskList | null {
  if (!isObj(raw)) return null;
  const tasks = list(raw.tasks, 2048).map(normalizeTask).filter((t): t is TesTask => t !== null);
  const tok = typeof raw.next_page_token === 'string' && raw.next_page_token.length > 0 && raw.next_page_token.length <= 2048 && /^[\x21-\x7e]+$/.test(raw.next_page_token) ? raw.next_page_token : null;
  return { tasks, next_page_token: tok };
}


import type { TesTaskSubmission } from './types';
import { isTaskUrl, hasDotDot } from '../urls';

export const LIMITS = { executors: 8, env: 64, inputs: 64, outputs: 64, tags: 32, command: 256, volumes: 8, zones: 8 } as const;
// eslint-disable-next-line no-control-regex
const NO_CTRL = /^[^\u0000-\u0008\u000B-\u001F\u007F]*$/;
const PRINTABLE = /^[\x20-\x7e]*$/;
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]{0,511}$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const TAG_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
// eslint-disable-next-line no-control-regex -- NUL is exactly what is refused
const NO_NUL = /^[^\u0000]*$/;
// eslint-disable-next-line no-control-regex -- NUL and line breaks are exactly what a path must not contain
const ABS_PATH = /^\/[^\u0000\n\r]{0,1023}$/;
/** Fields the server owns. Clients may send them (a task read back from TES), we never forward them. */
const READ_ONLY_FIELDS = ['id', 'state', 'logs', 'creation_time'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

class Errs {
  list: string[] = [];
  add(path: string, msg: string) { if (this.list.length < 25) this.list.push(`${path}: ${msg}`); }
}
function keys(o: Obj, allowed: string[], path: string, e: Errs) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) e.add(path, `unknown field "${k.slice(0, 40)}"`);
}
function str(v: unknown, path: string, e: Errs, max: number, opts: { re?: RegExp; min?: number } = {}): v is string {
  if (typeof v !== 'string') { e.add(path, 'must be a string'); return false; }
  if (v.length > max || v.length < (opts.min ?? 0)) { e.add(path, `length must be ${opts.min ?? 0}..${max}`); return false; }
  if (opts.re && !opts.re.test(v)) { e.add(path, 'has invalid characters'); return false; }
  return true;
}
function arr(v: unknown, path: string, e: Errs, max: number): v is unknown[] {
  if (!Array.isArray(v)) { e.add(path, 'must be an array'); return false; }
  if (v.length > max) { e.add(path, `at most ${max} items`); return false; }
  return true;
}
function num(v: unknown, path: string, e: Errs, min: number, max: number, int = false): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) e.add(path, `must be ${int ? 'an integer' : 'a number'} in ${min}..${max}`);
}
const bool = (v: unknown, path: string, e: Errs) => { if (typeof v !== 'boolean') e.add(path, 'must be a boolean'); };

/** Remove server-owned fields from a client-supplied task. */
export function stripReadOnly(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const out: Obj = { ...raw };
  for (const f of READ_ONLY_FIELDS) delete out[f];
  return out;
}

type ValidationResult = { ok: true; task: TesTaskSubmission } | { ok: false; errors: string[] };

/** Strict validation of a task we are about to send. Unknown keys are rejected. Does NOT mutate. */
export function validateTaskSubmission(raw: unknown): ValidationResult {
  const e = new Errs();
  if (!isObj(raw)) return { ok: false, errors: ['task: must be an object'] };
  keys(raw, ['name', 'description', 'inputs', 'outputs', 'resources', 'executors', 'volumes', 'tags'], 'task', e);
  if (raw.name !== undefined) str(raw.name, 'name', e, 256, { re: NO_CTRL });
  if (raw.description !== undefined) str(raw.description, 'description', e, 4096, { re: NO_CTRL });

  if (arr(raw.executors, 'executors', e, LIMITS.executors)) {
    if (raw.executors.length === 0) e.add('executors', 'at least one executor is required');
    raw.executors.forEach((x, i) => {
      const p = `executors[${i}]`;
      if (!isObj(x)) return e.add(p, 'must be an object');
      keys(x, ['image', 'command', 'workdir', 'stdin', 'stdout', 'stderr', 'env', 'ignore_error'], p, e);
      if (str(x.image, `${p}.image`, e, 512, { re: IMAGE, min: 1 }) && hasDotDot(x.image)) e.add(`${p}.image`, 'must not contain ".."');
      if (arr(x.command, `${p}.command`, e, LIMITS.command)) {
        if (x.command.length === 0) e.add(`${p}.command`, 'at least one element');
        x.command.forEach((c, j) => str(c, `${p}.command[${j}]`, e, 4096, { re: NO_NUL }));
      }
      for (const f of ['workdir', 'stdin', 'stdout', 'stderr'] as const) if (x[f] !== undefined) { if (str(x[f], `${p}.${f}`, e, 1024, { re: ABS_PATH }) && hasDotDot(x[f] as string)) e.add(`${p}.${f}`, 'must not contain ".."'); }
      if (x.ignore_error !== undefined) bool(x.ignore_error, `${p}.ignore_error`, e);
      if (x.env !== undefined) {
        if (!isObj(x.env)) e.add(`${p}.env`, 'must be an object');
        else {
          const ks = Object.keys(x.env);
          if (ks.length > LIMITS.env) e.add(`${p}.env`, `at most ${LIMITS.env} entries`);
          for (const k of ks.slice(0, LIMITS.env)) {
            if (!ENV_KEY.test(k)) e.add(`${p}.env`, `invalid variable name "${k.slice(0, 40)}"`);
            str((x.env as Obj)[k], `${p}.env.${k.slice(0, 40)}`, e, 4096, { re: PRINTABLE });
          }
        }
      }
    });
  }

  const fileList = (field: 'inputs' | 'outputs') => {
    const v = raw[field];
    if (v === undefined) return;
    if (!arr(v, field, e, LIMITS[field])) return;
    v.forEach((x, i) => {
      const p = `${field}[${i}]`;
      if (!isObj(x)) return e.add(p, 'must be an object');
      keys(x, field === 'inputs' ? ['name', 'description', 'url', 'path', 'type', 'content', 'streamable'] : ['name', 'description', 'url', 'path', 'path_prefix', 'type'], p, e);
      if (x.name !== undefined) str(x.name, `${p}.name`, e, 256, { re: NO_CTRL });
      if (x.description !== undefined) str(x.description, `${p}.description`, e, 1024, { re: NO_CTRL });
      if (str(x.path, `${p}.path`, e, 1024, { re: ABS_PATH }) && hasDotDot(x.path)) e.add(`${p}.path`, 'must not contain ".."');
      if (x.type !== undefined && x.type !== 'FILE' && x.type !== 'DIRECTORY') e.add(`${p}.type`, 'must be FILE or DIRECTORY');
      if (x.url !== undefined && !isTaskUrl(x.url)) e.add(`${p}.url`, 'must be an s3:// URL or an allowed https:// URL');
      if (field === 'inputs') {
        if (x.content !== undefined) str(x.content, `${p}.content`, e, 64 * 1024, { re: NO_NUL });
        if ((x.url === undefined) === (x.content === undefined)) e.add(p, 'exactly one of url or content is required');
        if (x.streamable !== undefined) bool(x.streamable, `${p}.streamable`, e);
      } else {
        if (x.url === undefined) e.add(`${p}.url`, 'is required');
        if (x.path_prefix !== undefined && str(x.path_prefix, `${p}.path_prefix`, e, 1024, { re: ABS_PATH }) && hasDotDot(x.path_prefix)) e.add(`${p}.path_prefix`, 'must not contain ".."');
        if (typeof x.path === 'string' && /[*?[]/.test(x.path) && x.path_prefix === undefined) e.add(`${p}.path_prefix`, 'is required when path has wildcards');
      }
    });
  };
  fileList('inputs');
  fileList('outputs');

  if (raw.resources !== undefined) {
    const r = raw.resources;
    if (!isObj(r)) e.add('resources', 'must be an object');
    else {
      // backend_parameters steer the scheduler arbitrarily; they are refused (fail closed).
      keys(r, ['cpu_cores', 'preemptible', 'ram_gb', 'disk_gb', 'zones'], 'resources', e);
      if (r.cpu_cores !== undefined) num(r.cpu_cores, 'resources.cpu_cores', e, 1, 16, true);
      if (r.ram_gb !== undefined) num(r.ram_gb, 'resources.ram_gb', e, 0.1, 128);
      if (r.disk_gb !== undefined) num(r.disk_gb, 'resources.disk_gb', e, 0.1, 500);
      if (r.preemptible !== undefined) bool(r.preemptible, 'resources.preemptible', e);
      if (r.zones !== undefined && arr(r.zones, 'resources.zones', e, LIMITS.zones)) r.zones.forEach((z, i) => str(z, `resources.zones[${i}]`, e, 64, { re: /^[A-Za-z0-9._-]+$/ }));
    }
  }
  if (raw.volumes !== undefined && arr(raw.volumes, 'volumes', e, LIMITS.volumes)) raw.volumes.forEach((v, i) => { if (str(v, `volumes[${i}]`, e, 1024, { re: ABS_PATH }) && hasDotDot(v)) e.add(`volumes[${i}]`, 'must not contain ".."'); });
  if (raw.tags !== undefined) {
    if (!isObj(raw.tags)) e.add('tags', 'must be an object');
    else {
      const ks = Object.keys(raw.tags);
      if (ks.length > LIMITS.tags) e.add('tags', `at most ${LIMITS.tags} entries`);
      for (const k of ks.slice(0, LIMITS.tags)) {
        if (!TAG_KEY.test(k)) e.add('tags', `invalid tag key "${k.slice(0, 40)}"`);
        str((raw.tags as Obj)[k], `tags.${k.slice(0, 40)}`, e, 256, { re: NO_CTRL });
      }
    }
  }
  return e.list.length ? { ok: false, errors: e.list } : { ok: true, task: raw as unknown as TesTaskSubmission };
}

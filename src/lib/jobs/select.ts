import type { Runner } from './runner';
import { RunnerConfigError } from './runner';
import { daguRunner } from './dagu/daguRunner';
import { tesRunner } from './tes/tesRunner';

/**
 * Runner registry: a new adapter is ONE file implementing Runner plus ONE line here.
 * Selected by env JOBS_RUNNER (unset or empty = 'tes'); any other value throws RunnerConfigError (fail closed, no fallback).
 */
const RUNNERS: Readonly<Record<string, Runner>> = { tes: tesRunner, dagu: daguRunner };

export function runnerId(env: Record<string, string | undefined> = process.env): string {
  const v = (env.JOBS_RUNNER ?? '').trim() || 'tes';
  if (!Object.prototype.hasOwnProperty.call(RUNNERS, v)) throw new RunnerConfigError('unknown runner');
  return v;
}

export function getRunner(env: Record<string, string | undefined> = process.env): Runner {
  return RUNNERS[runnerId(env)];
}

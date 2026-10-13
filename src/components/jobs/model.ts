import type { Run, RunState } from '@/lib/jobs/model';
import { isActive, RUN_STATES } from '@/lib/jobs/model';

export { isCancellable, isTerminal } from '@/lib/jobs/model';
export { RUN_STATES };

/** Neutral states only; the runner's own word is shown separately as secondary text (backend_state). */
export const STATE_META: Record<RunState, { label: string; color: string }> = {
  unknown: { label: 'Unknown', color: 'gray' },
  queued: { label: 'Queued', color: 'gray' },
  starting: { label: 'Starting', color: 'blue' },
  running: { label: 'Running', color: 'blue' },
  succeeded: { label: 'Succeeded', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  cancelled: { label: 'Cancelled', color: 'dark' },
};

export type { PollPhase } from '@/lib/api-query';
export { nextDelay } from '@/lib/api-query';
export { DRAWER_POLL, RUNS_POLL } from '@/lib/jobs/api/hooks';

/** Only runs that can still change are worth polling for; terminal runs are never fetched again on their own. */
export const anyActive = (runs: readonly Run[] | undefined): boolean => !!runs?.some(isActive);

/** Show an argv array so that boundaries between arguments stay visible. */
export const argvText = (argv: readonly string[]): string => argv.map((a) => (a === '' || /[\s"'\\]/.test(a) ? JSON.stringify(a) : a)).join(' ');

export function resourcesText(r: { cpu_cores?: number; ram_gb?: number; disk_gb?: number; preemptible?: boolean } | null | undefined): string {
  if (!r) return '—';
  const parts = [
    r.cpu_cores !== undefined ? `${r.cpu_cores} CPU` : null,
    r.ram_gb !== undefined ? `${r.ram_gb} GB RAM` : null,
    r.disk_gb !== undefined ? `${r.disk_gb} GB disk` : null,
    r.preemptible ? 'preemptible' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export function lastLines(text: string, n = 8): string {
  const lines = text.split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.slice(-n).join('\n');
}

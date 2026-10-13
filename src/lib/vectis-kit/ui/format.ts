export const formatNumber = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  let v = n;
  let i = 0;
  while (v >= 1000 && i < UNITS.length - 1) { v /= 1000; i += 1; }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${UNITS[i]}`;
}

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  const abs = Math.abs(s);
  const unit = abs < 60 ? [abs, 's'] : abs < 3600 ? [Math.round(abs / 60), 'm'] : abs < 86_400 ? [Math.round(abs / 3600), 'h'] : [Math.round(abs / 86_400), 'd'];
  return s >= 0 ? `${unit[0]}${unit[1]} ago` : `in ${unit[0]}${unit[1]}`;
}

export const formatTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';

export const formatPercent = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

/** "1m 23s". Missing or inconsistent times are "—", never zero. */
export function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '—';
  const s = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

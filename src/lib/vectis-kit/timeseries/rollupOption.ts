import { neutraliseBraces } from '@/lib/safe-text';
/**
 * Pure helpers that turn rollup points into an ECharts option, a text summary and brush ranges.
 * Domain-agnostic: it knows about buckets, counts, distinct counts and an optional magnitude, not about security.
 * Nothing here touches the DOM, so every edge case is unit-testable.
 */
import type { ReactEChartsProps } from '@gen3/frontend';
import type { TimelinePoint } from '@/lib/vectis-kit/spec';

type RollupOption = ReactEChartsProps['option'];
export type Grain = '1m' | '5m' | '1h';
export interface TimeRange { start: string; end: string }

const GRAIN_MS: Readonly<Record<Grain, number>> = { '1m': 60_000, '5m': 300_000, '1h': 3_600_000 };
const GRAIN_LABEL: Readonly<Record<Grain, string>> = { '1m': '1 minute', '5m': '5 minutes', '1h': '1 hour' };

type XY = [number, number];

interface RollupGroup {
  /** '' means "not grouped" */
  key: string;
  total: number;
  events: XY[];
  /** A null value is a gap in the line: the count was not exactly measurable, which is not zero. */
  ips: [number, number | null][];
  /** Only buckets that actually carry a value. A missing value is omitted, never drawn as zero. */
  bytes: XY[];
}

interface PreparedRollup {
  groups: RollupGroup[];
  grouped: boolean;
  /** Groups beyond `maxGroups`, reported rather than silently dropped. */
  hiddenGroups: number;
  /** Points whose timestamp could not be read. */
  skipped: number;
}

const NO_GROUP_LABEL = 'All events';
const NONE_VALUE = '(none)';

export const groupKey = (dims: TimelinePoint['dims']): string =>
  Object.keys(dims ?? {}).sort().map((k) => (dims as Record<string, string | null>)[k] ?? NONE_VALUE).join(' / ');

export function prepareRollup(points: readonly TimelinePoint[], maxGroups = 12): PreparedRollup {
  const byKey = new Map<string, RollupGroup>();
  let skipped = 0;
  for (const p of points) {
    const t = Date.parse(p.bucket_start);
    if (!Number.isFinite(t)) { skipped += 1; continue; }
    const key = groupKey(p.dims);
    let g = byKey.get(key);
    if (!g) { g = { key, total: 0, events: [], ips: [], bytes: [] }; byKey.set(key, g); }
    g.total += p.event_count;
    g.events.push([t, p.event_count]);
    // null = not exactly measured: the line leaves a gap and the table says so; it is never drawn as zero.
    g.ips.push([t, p.distinct_src_ips ?? null]);
    if (p.bytes_out_max !== null && p.bytes_out_max !== undefined) g.bytes.push([t, p.bytes_out_max]);
  }
  const all = [...byKey.values()];
  for (const g of all) { g.events.sort((a, b) => a[0] - b[0]); g.ips.sort((a, b) => a[0] - b[0]); g.bytes.sort((a, b) => a[0] - b[0]); }
  all.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const grouped = all.some((g) => g.key !== '');
  return { groups: all.slice(0, maxGroups), grouped, hiddenGroups: Math.max(0, all.length - maxGroups), skipped };
}

const bytesLabel = (n: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n; let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i += 1; }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
};

interface BuildOptions {
  grain: Grain;
  /** Add a dataZoom slider under the chart. */
  zoom?: boolean;
  /** Enable the time-range brush (toolbox + brush config). */
  brush?: boolean;
  maxGroups?: number;
}

export function buildRollupOption(points: readonly TimelinePoint[], opts: BuildOptions): RollupOption {
  const prep = prepareRollup(points, opts.maxGroups);
  const series: Record<string, unknown>[] = [];
  const yAxis: Record<string, unknown>[] = [{ type: 'value', name: 'Events', minInterval: 1, nameLocation: 'middle', nameRotate: 90, nameGap: 56 }];
  let hasBytes = false;

  if (!prep.grouped) {
    const g = prep.groups[0];
    if (g) {
      series.push({ name: NO_GROUP_LABEL, type: 'line', yAxisIndex: 0, data: g.events, showSymbol: g.events.length <= 1, symbolSize: 6, areaStyle: { opacity: 0.18 }, lineStyle: { width: 2 }, emphasis: { focus: 'series' } });
      yAxis.push({ type: 'value', name: 'Distinct source IPs', position: 'right', minInterval: 1, splitLine: { show: false }, nameLocation: 'middle', nameRotate: -90, nameGap: 40 });
      series.push({ name: 'Distinct source IPs', type: 'line', yAxisIndex: 1, data: g.ips, showSymbol: g.ips.length <= 1, symbolSize: 6, lineStyle: { width: 1.5, type: 'dashed' }, emphasis: { focus: 'series' } });
      if (g.bytes.length > 0) {
        hasBytes = true;
        yAxis.push({ type: 'value', name: 'Max bytes out', position: 'right', offset: 64, splitLine: { show: false }, axisLabel: { formatter: (v: number) => bytesLabel(v) }, nameLocation: 'middle', nameRotate: -90, nameGap: 52 });
        series.push({ name: 'Max bytes out', type: 'scatter', yAxisIndex: 2, data: g.bytes, symbol: 'diamond', symbolSize: 7, tooltip: { valueFormatter: (v: number) => bytesLabel(v) } });
      }
    }
  } else {
    for (const g of prep.groups) {
      series.push({ name: g.key === '' ? NO_GROUP_LABEL : g.key, type: 'line', yAxisIndex: 0, data: g.events, showSymbol: g.events.length <= 1, symbolSize: 6, lineStyle: { width: 1.75 }, emphasis: { focus: 'series' } });
    }
  }

  const option: Record<string, unknown> = {
    animation: false,
    grid: { left: 88, right: hasBytes ? 176 : prep.grouped ? 24 : 84, top: series.length > 1 || opts.brush ? 44 : 24, bottom: opts.zoom ? 64 : 28, containLabel: false },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: series.length > 1 ? { type: 'scroll', top: 0, left: 0, right: opts.brush ? 120 : 0, formatter: (name: string) => neutraliseBraces(name) } : { show: false },
    xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
    yAxis,
    series,
  };
  if (opts.zoom) option.dataZoom = [{ type: 'slider', xAxisIndex: 0, height: 20, bottom: 12, filterMode: 'none' }];
  if (opts.brush) {
    option.brush = { xAxisIndex: 0, brushType: 'lineX', brushMode: 'single', transformable: true, throttleType: 'debounce', throttleDelay: 120, removeOnClick: true };
    option.toolbox = { right: 8, top: 0, feature: { brush: { type: ['lineX', 'clear'], title: { lineX: 'Select a time range', clear: 'Clear selection' } } } };
  }
  return option as RollupOption;
}

/** Snap a brushed span to whole buckets so the raw query covers exactly the rollup buckets the analyst saw. */
export function rangeFromCoords(a: number, b: number, grain: Grain): TimeRange | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const step = GRAIN_MS[grain];
  const lo = Math.floor(Math.min(a, b) / step) * step;
  let hi = Math.ceil(Math.max(a, b) / step) * step;
  if (hi <= lo) hi = lo + step;
  return { start: new Date(lo).toISOString(), end: new Date(hi).toISOString() };
}

/**
 * ECharts `brush` / `brushEnd` events carry `areas[].coordRange`. No areas means the selection was cleared (null).
 * Anything unreadable is ignored (undefined) rather than guessed.
 */
export function brushEventToRange(e: unknown, grain: Grain): TimeRange | null | undefined {
  const areas = (e as { areas?: unknown } | null | undefined)?.areas;
  if (!Array.isArray(areas)) return undefined;
  if (areas.length === 0) return null;
  const cr = (areas[0] as { coordRange?: unknown } | undefined)?.coordRange;
  if (!Array.isArray(cr) || cr.length !== 2) return undefined;
  const r = rangeFromCoords(Number(cr[0]), Number(cr[1]), grain);
  return r ?? undefined;
}

interface RollupSummary {
  buckets: number;
  totalEvents: number;
  groups: number;
  hiddenGroups: number;
  first: string | null;
  last: string | null;
  peak: { at: string; count: number } | null;
  text: string;
}

export function summarizeRollup(points: readonly TimelinePoint[], grain: Grain, maxGroups = 12): RollupSummary {
  const prep = prepareRollup(points, maxGroups);
  const times = new Set<number>();
  let total = 0;
  const perBucket = new Map<number, number>();
  for (const g of prep.groups) {
    for (const [t, c] of g.events) { times.add(t); total += c; perBucket.set(t, (perBucket.get(t) ?? 0) + c); }
  }
  const sorted = [...times].sort((a, b) => a - b);
  let peak: RollupSummary['peak'] = null;
  for (const [t, c] of perBucket) if (!peak || c > peak.count) peak = { at: new Date(t).toISOString(), count: c };
  const first = sorted.length ? new Date(sorted[0] as number).toISOString() : null;
  const last = sorted.length ? new Date(sorted[sorted.length - 1] as number).toISOString() : null;
  const text = sorted.length === 0
    ? 'No data points.'
    : `${sorted.length} buckets of ${GRAIN_LABEL[grain]} from ${first} to ${last}. ${total.toLocaleString('en-US')} events in total`
      + `${prep.grouped ? ` across ${prep.groups.length} group${prep.groups.length === 1 ? '' : 's'}${prep.hiddenGroups ? ` (${prep.hiddenGroups} smaller groups not drawn)` : ''}` : ''}. `
      + `Peak: ${peak?.count.toLocaleString('en-US')} events in the bucket starting ${peak?.at}.`;
  return { buckets: sorted.length, totalEvents: total, groups: prep.groups.length, hiddenGroups: prep.hiddenGroups, first, last, peak, text };
}

interface TableRow { time: string; group: string; events: number; distinctIps: number | null; bytesMax: number | null }

/** Rows for the text alternative. Capped; the cap is reported by the caller, never hidden. */
export function tableRows(points: readonly TimelinePoint[], limit = 200): { rows: TableRow[]; total: number } {
  const valid = points.filter((p) => Number.isFinite(Date.parse(p.bucket_start)));
  const rows = [...valid]
    .sort((a, b) => Date.parse(a.bucket_start) - Date.parse(b.bucket_start))
    .slice(0, limit)
    .map((p) => ({ time: p.bucket_start, group: groupKey(p.dims) || NO_GROUP_LABEL, events: p.event_count, distinctIps: p.distinct_src_ips ?? null, bytesMax: p.bytes_out_max ?? null }));
  return { rows, total: valid.length };
}

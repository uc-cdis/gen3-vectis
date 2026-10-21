/** ECharts options for treemap, sunburst and bar charts over an aggregate, plus the saved-chart list. Heat map is in heatmapOption.ts. */
import type { ReactEChartsProps } from '@gen3/frontend';
import type { AggregateResponse, ColumnMeta } from '@/lib/vectis-kit/spec';
import { escapeHtml, neutraliseBraces } from '@/lib/safe-text';
import { NONE_LABEL } from './heatmapOption';

type ChartOption = ReactEChartsProps['option'];

export const CHART_KINDS = ['heatmap', 'treemap', 'sunburst', 'bar'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface SavedChart {
  kind: ChartKind;
  title: string;
  group_by: string[];
  top_n: number;
}

const MAX_CHARTS = 4;
const DEFAULT_TOP_N = 15;

/** Columns a chart can group by: not PII, filterable, not an id or timestamp. */
export const chartColumns = (columns: readonly ColumnMeta[]): ColumnMeta[] =>
  columns.filter((c) => !c.pii && c.filterable !== false && c.name !== 'id' && ['string', 'ip', 'enum', 'boolean', 'integer'].includes(c.type));

/** Charts from a saved view's layout. The layout comes from the API, so entries whose columns are not groupable are dropped. */
export function parseCharts(layout: Record<string, unknown> | null | undefined, columns: readonly ColumnMeta[]): SavedChart[] {
  const raw = layout && typeof layout === 'object' ? (layout as { charts?: unknown }).charts : undefined;
  if (!Array.isArray(raw)) return [];
  const usable = new Set(chartColumns(columns).map((c) => c.name));
  const out: SavedChart[] = [];
  for (const item of raw) {
    if (out.length >= MAX_CHARTS) break;
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const kind = c.kind;
    const group = c.group_by;
    if (typeof kind !== 'string' || !(CHART_KINDS as readonly string[]).includes(kind)) continue;
    if (!Array.isArray(group) || group.length < 1 || group.length > 2) continue;
    if (!group.every((g): g is string => typeof g === 'string' && usable.has(g)) || new Set(group).size !== group.length) continue;
    if (kind === 'heatmap' && group.length !== 2) continue;
    const topN = typeof c.top_n === 'number' && Number.isFinite(c.top_n) ? Math.min(50, Math.max(1, Math.trunc(c.top_n))) : DEFAULT_TOP_N;
    const title = typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 120) : '';
    out.push({ kind: kind as ChartKind, title, group_by: group as string[], top_n: topN });
  }
  return out;
}

/** Indexes of grouped columns that are empty in every row. */
export function unfilledDimensions(rows: AggregateResponse['rows'], dims: number): number[] {
  if (rows.length === 0) return [];
  return Array.from({ length: dims }, (_, i) => i).filter((i) => rows.every((r) => r.values[i] === null || r.values[i] === undefined || r.values[i] === ''));
}

/** Categorical palette. */
export const PALETTE = ['#4e79a7', '#d9822b', '#3f9c97', '#9a6fb0', '#b59a2a', '#8c6a52', '#4f9a4a', '#cc5b7a', '#5b8fb9', '#7f8c8d'] as const;
const GOOD = '#4f9a4a';
const BAD = '#d6504d';
const WARN = '#d9a21b';
const NEUTRAL = '#a9b0b7';
const SEMANTIC: Record<string, string> = {
  allow: GOOD, allowed: GOOD, success: GOOD, succeeded: GOOD, ok: GOOD, pass: GOOD, passed: GOOD, accept: GOOD, accepted: GOOD,
  block: BAD, blocked: BAD, deny: BAD, denied: BAD, fail: BAD, failed: BAD, failure: BAD, reject: BAD, rejected: BAD, critical: BAD, high: '#e8805a',
  challenge: WARN, captcha: WARN, count: WARN, medium: WARN, warn: WARN, warning: WARN, error: '#f28e2b', low: '#8fb8d8', info: '#8fb8d8',
  unknown: NEUTRAL, '(none)': NEUTRAL, other: NEUTRAL,
};

/** Same colour for the same value everywhere: outcomes and severities use fixed colours, the rest hash into the palette. */
export function colorFor(value: string): string {
  const known = SEMANTIC[value.trim().toLowerCase()];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] as string;
}

const name = (v: string | null | undefined): string => (v === null || v === undefined || v === '' ? NONE_LABEL : v);
const num = (n: number) => Number(n).toLocaleString('en-US');

interface TreeNode { name: string; value: number; itemStyle?: { color: string }; children?: TreeNode[] }

/** Counts as a tree of first-column values with second-column children, biggest first. */
export function prepareTree(rows: AggregateResponse['rows'], opts: { solidParents?: boolean } = {}): TreeNode[] {
  const parents = new Map<string, { value: number; kids: Map<string, number> }>();
  for (const r of rows) {
    const a = name(r.values[0]);
    const entry = parents.get(a) ?? { value: 0, kids: new Map<string, number>() };
    entry.value += r.count;
    if (r.values.length > 1) {
      const b = name(r.values[1]);
      entry.kids.set(b, (entry.kids.get(b) ?? 0) + r.count);
    }
    parents.set(a, entry);
  }
  const bySize = <T extends { value: number; name: string }>(x: T[]) => x.sort((p, q) => q.value - p.value || p.name.localeCompare(q.name));
  const two = rows.some((r) => r.values.length > 1);
  return bySize([...parents.entries()].map(([k, v]) => {
    // With two columns the children carry the colour; with one, the parents do.
    const kids = bySize([...v.kids.entries()].map(([n, value]) => ({ name: neutraliseBraces(n), value, itemStyle: { color: colorFor(n) } })));
    const own = { color: two && !opts.solidParents ? '#eef0f2' : colorFor(k) };
    return kids.length > 0 ? { name: neutraliseBraces(k), value: v.value, itemStyle: own, children: kids } : { name: neutraliseBraces(k), value: v.value, itemStyle: own };
  }));
}

const tooltip = (unit: string) => ({
  // Event data goes into an HTML tooltip, so escape it.
  formatter: (p: { name?: string; value?: number; treePathInfo?: { name: string }[] }) => {
    const path = (p.treePathInfo ?? []).map((n) => n.name).filter(Boolean);
    const label = path.length > 0 ? path.join(' / ') : (p.name ?? '');
    return `${escapeHtml(label)}: <b>${num(Number(p.value ?? 0))}</b> ${escapeHtml(unit)}`;
  },
});

export function buildTreemapOption(rows: AggregateResponse['rows'], unit = 'records'): ChartOption {
  const two = rows.some((r) => r.values.length > 1);
  return {
    animation: false,
    tooltip: tooltip(unit),
    series: [{
      type: 'treemap', data: prepareTree(rows), roam: false, nodeClick: false, breadcrumb: { show: false },
      width: '100%', height: '100%', top: 0, bottom: 0, left: 0, right: 0,
      label: { show: true, formatter: '{b}', overflow: 'truncate', color: '#fff', fontWeight: 500, textShadowBlur: 2, textShadowColor: 'rgba(0,0,0,.45)' },
      upperLabel: { show: two, height: 24, color: '#2b2f33', fontWeight: 600, overflow: 'truncate' },
      itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2, borderRadius: 3 },
      levels: [
        { itemStyle: { borderColor: '#fff', borderWidth: 4, gapWidth: 4 } },
        { itemStyle: { borderColor: '#fff', borderWidth: 2, gapWidth: 2, borderRadius: 3 } },
      ],
    }],
  } as unknown as ChartOption;
}

export function buildSunburstOption(rows: AggregateResponse['rows'], unit = 'records'): ChartOption {
  return {
    animation: false,
    tooltip: tooltip(unit),
    series: [{
      type: 'sunburst', data: prepareTree(rows, { solidParents: true }), radius: ['12%', '92%'], sort: 'desc',
      label: { rotate: 'radial', minAngle: 8, overflow: 'truncate', color: '#fff', textShadowBlur: 2, textShadowColor: 'rgba(0,0,0,.4)' },
      itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 3 },
      emphasis: { focus: 'ancestor' },
    }],
  } as unknown as ChartOption;
}

/** Ranked bars of the first column, stacked by the second when present. */
export function buildBarOption(rows: AggregateResponse['rows'], labels: { row: string; col?: string }, unit = 'records'): ChartOption {
  const tree = prepareTree(rows);
  const cats = tree.map((t) => t.name);
  const stacked = rows.some((r) => r.values.length > 1);
  const kidTotals = new Map<string, number>();
  for (const t of tree) for (const k of t.children ?? []) kidTotals.set(k.name, (kidTotals.get(k.name) ?? 0) + k.value);
  const kidNames = [...kidTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  const series = stacked
    ? kidNames.map((kid) => ({
      name: kid, type: 'bar', stack: 'total', emphasis: { focus: 'series' }, itemStyle: { color: colorFor(kid) }, barMaxWidth: 26,
      data: tree.map((t) => t.children?.find((k) => k.name === kid)?.value ?? 0),
    }))
    : [{ name: unit, type: 'bar', barMaxWidth: 26, itemStyle: { color: PALETTE[0], borderRadius: [0, 3, 3, 0] }, data: tree.map((t) => t.value) }];
  return {
    animation: false,
    grid: { left: 150, right: 24, top: stacked ? 34 : 10, bottom: 34, containLabel: false },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (items: { axisValueLabel?: string; seriesName?: string; value?: number }[]) => {
        const list = Array.isArray(items) ? items : [];
        const head = escapeHtml(list[0]?.axisValueLabel ?? '');
        const lines = list.filter((i) => Number(i.value) > 0).map((i) => `${escapeHtml(i.seriesName ?? '')}: <b>${num(Number(i.value))}</b>`);
        return [head, ...lines].join('<br/>');
      },
    },
    legend: stacked ? { type: 'scroll', top: 0 } : undefined,
    xAxis: { type: 'value', name: unit, nameLocation: 'middle', nameGap: 24, splitLine: { lineStyle: { color: '#eceff1' } } },
    yAxis: { type: 'category', data: cats, inverse: true, name: labels.row, axisLabel: { width: 150, overflow: 'truncate' } },
    series,
  } as unknown as ChartOption;
}

export function summarizeChart(kind: ChartKind, rows: AggregateResponse['rows'], labels: string[], total: number, truncated: boolean, unit = 'records'): string {
  if (rows.length === 0) return `No ${unit} in this window.`;
  const tree = prepareTree(rows);
  const top = tree[0];
  const shown = rows.reduce((s, r) => s + r.count, 0);
  const by = labels.join(' and ');
  return `${kind === 'bar' ? 'Ranked' : 'Grouped'} by ${by}: ${tree.length} values, ${num(shown)} of ${num(total)} ${unit}${truncated ? ' (the most frequent values only)' : ''}.`
    + (top ? ` Largest: ${top.name}, ${num(top.value)}.` : '');
}

/** Turns an aggregate (counts by two columns) into a heat map grid, ECharts option and text summary. Names come from event data: canvas text or escapeHtml only. */
import type { ReactEChartsProps } from '@gen3/frontend';
import type { AggregateResponse } from '@/lib/vectis-kit/spec';
import { escapeHtml, neutraliseBraces } from '@/lib/safe-text';

type HeatOption = ReactEChartsProps['option'];

export const NONE_LABEL = '(none)';
/** Above this many cells the counts are not drawn inside them. */
const LABEL_CELL_LIMIT = 180;

export interface HeatGrid {
  /** First-column values, most frequent first (rows). */
  rowValues: string[];
  /** Second-column values, most frequent first (columns). A single "events" column when only one was grouped. */
  colValues: string[];
  /** [colIndex, rowIndex, count] */
  cells: [number, number, number][];
  max: number;
  /** Events in the cells drawn. */
  shown: number;
}

const name = (v: string | null | undefined): string => (v === null || v === undefined || v === '' ? NONE_LABEL : v);

export function prepareHeatmap(rows: AggregateResponse['rows']): HeatGrid {
  const rowTotal = new Map<string, number>();
  const colTotal = new Map<string, number>();
  const counts = new Map<string, number>();
  let shown = 0;
  for (const r of rows) {
    const a = name(r.values[0]);
    const b = r.values.length > 1 ? name(r.values[1]) : 'events';
    rowTotal.set(a, (rowTotal.get(a) ?? 0) + r.count);
    colTotal.set(b, (colTotal.get(b) ?? 0) + r.count);
    counts.set(JSON.stringify([a, b]), (counts.get(JSON.stringify([a, b])) ?? 0) + r.count);
    shown += r.count;
  }
  const order = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([k]) => k);
  const rowValues = order(rowTotal);
  const colValues = order(colTotal);
  const cells: [number, number, number][] = [];
  let max = 0;
  for (const [k, n] of counts) {
    const [a, b] = JSON.parse(k) as [string, string];
    cells.push([colValues.indexOf(b), rowValues.indexOf(a), n]);
    if (n > max) max = n;
  }
  return { rowValues, colValues, cells, max, shown };
}

export function buildHeatmapOption(grid: HeatGrid, labels: { row: string; col: string }): HeatOption {
  const showLabels = grid.cells.length <= LABEL_CELL_LIMIT;
  // Left margin follows the longest row name; slant column names when there are many.
  const longest = grid.rowValues.reduce((m, v) => Math.max(m, v.length), 0);
  const left = Math.min(215, Math.max(90, Math.round(longest * 6.5) + 36));
  const slant = grid.colValues.length > 4 ? 32 : 0;
  const option = {
    animation: false,
    grid: { left, right: 90, top: slant ? 70 : 36, bottom: 8, containLabel: false },
    tooltip: {
      position: 'top',
      // Event data in an HTML tooltip: escape it.
      formatter: (p: { value?: [number, number, number] }) => {
        const v = p.value;
        if (!v) return '';
        return `${escapeHtml(grid.rowValues[v[1]] ?? '')}<br/>${escapeHtml(grid.colValues[v[0]] ?? '')}: <b>${Number(v[2]).toLocaleString('en-US')}</b> events`;
      },
    },
    xAxis: {
      type: 'category', data: grid.colValues.map(neutraliseBraces), position: 'top', name: labels.col, nameLocation: 'middle', nameGap: slant ? 52 : 26,
      splitArea: { show: true }, axisLabel: { interval: 0, hideOverlap: false, rotate: slant },
    },
    yAxis: {
      type: 'category', data: grid.rowValues.map(neutraliseBraces), inverse: true, name: labels.row, nameLocation: 'middle', nameGap: left - 30,
      splitArea: { show: true }, axisLabel: { width: left - 20, overflow: 'truncate' },
    },
    visualMap: {
      min: 0, max: Math.max(1, grid.max), calculable: true, orient: 'vertical', right: 4, top: 'middle', itemHeight: 140,
      inRange: { color: ['#fbeeee', '#e9a3a3', '#b03030', '#6e0f0f'] },
    },
    series: [{
      type: 'heatmap', data: grid.cells,
      label: { show: showLabels, formatter: (p: { value: [number, number, number] }) => String(p.value[2]) },
      emphasis: { itemStyle: { borderColor: '#333', borderWidth: 1 } },
      itemStyle: { borderColor: '#fff', borderWidth: 1 },
    }],
  };
  return option as unknown as HeatOption;
}

export function summarizeHeatmap(grid: HeatGrid, labels: { row: string; col: string }, total: number, truncated: boolean): string {
  if (grid.cells.length === 0) return 'No events in this window.';
  const top = grid.cells.reduce((m, c) => (c[2] > m[2] ? c : m), grid.cells[0] as [number, number, number]);
  return `${grid.rowValues.length} ${labels.row} values by ${grid.colValues.length} ${labels.col} values, ${grid.shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} events`
    + `${truncated ? ' (the most frequent values only)' : ''}. Busiest cell: ${grid.rowValues[top[1]]} and ${grid.colValues[top[0]]}, ${top[2].toLocaleString('en-US')} events.`;
}

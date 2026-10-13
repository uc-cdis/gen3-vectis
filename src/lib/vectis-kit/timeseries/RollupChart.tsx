import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, Table, Text, TextInput, VisuallyHidden } from '@mantine/core';
import { ReactECharts } from '@gen3/frontend';
import type { ReactEChartsProps } from '@gen3/frontend';
import type { TimelinePoint } from '@/lib/vectis-kit/spec';
import type { Grain, TimeRange } from './rollupOption';
import { brushEventToRange, buildRollupOption, rangeFromCoords, summarizeRollup, tableRows } from './rollupOption';

type Handle = NonNullable<NonNullable<ReactEChartsProps['ref']>['current']>;

interface RollupChartProps {
  points: readonly TimelinePoint[];
  grain: Grain;
  /** Called with the brushed span (ISO start/end, snapped to buckets) or null when the selection is cleared. Omit to disable brushing. */
  onRangeSelect?: (range: TimeRange | null) => void;
  zoom?: boolean;
  height?: number;
  /** Names the chart for assistive technology. */
  label: string;
  /** Shown instead of a chart when there are no points. The caller owns the wording. */
  empty?: React.ReactNode;
}

const toLocalInput = (ms: number): string => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

/** Keyboard route to the same brush: two date-time fields. */
function RangeFields({ points, grain, onSelect }: { points: readonly TimelinePoint[]; grain: Grain; onSelect: (r: TimeRange) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const apply = () => {
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    if (!from || !to || !Number.isFinite(a) || !Number.isFinite(b)) return setProblem('Enter both a start and an end.');
    if (a >= b) return setProblem('The start must be before the end.');
    const r = rangeFromCoords(a, b, grain);
    if (!r) return setProblem('That range could not be used.');
    setProblem(null);
    onSelect(r);
  };
  const first = points.reduce((m, p) => { const t = Date.parse(p.bucket_start); return Number.isFinite(t) && t < m ? t : m; }, Infinity);
  return (
    <Group align="flex-end" gap="xs" mt="xs">
      <TextInput type="datetime-local" size="xs" label="From (local time)" value={from} min={Number.isFinite(first) ? toLocalInput(first) : undefined} onChange={(e) => setFrom(e.currentTarget.value)} />
      <TextInput type="datetime-local" size="xs" label="To (local time)" value={to} onChange={(e) => setTo(e.currentTarget.value)} error={problem} />
      <Button size="xs" variant="default" onClick={apply}>Use this range</Button>
    </Group>
  );
}

/**
 * A rollup time-series: counts as an area, distinct counts on a second axis, optional magnitude markers,
 * a dataZoom slider and a brush that reports a time range. Always paired with a text summary and a data table.
 */
export const RollupChart = ({ points, grain, onRangeSelect, zoom = true, height = 320, label, empty }: RollupChartProps) => {
  const ref = useRef<Handle | null>(null);
  const brushable = onRangeSelect !== undefined;
  const option = useMemo(() => buildRollupOption(points, { grain, zoom, brush: brushable }), [points, grain, zoom, brushable]);
  const summary = useMemo(() => summarizeRollup(points, grain), [points, grain]);
  const table = useMemo(() => tableRows(points), [points]);

  const events = useMemo(() => {
    if (!onRangeSelect) return undefined;
    const handle = (e: unknown) => {
      const r = brushEventToRange(e, grain);
      if (r !== undefined) onRangeSelect(r);
    };
    return { brushEnd: handle, brush: (e: unknown) => { if (brushEventToRange(e, grain) === null) onRangeSelect(null); } };
  }, [onRangeSelect, grain]);

  // Put the chart straight into range-selection mode so a drag selects, with no extra click.
  useEffect(() => {
    if (!brushable) return undefined;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const activate = () => {
      const inst = ref.current?.getEchartsInstance();
      if (inst) inst.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
      else if (tries < 20) { tries += 1; timer = setTimeout(activate, 50); }
    };
    activate();
    return () => { if (timer) clearTimeout(timer); };
  }, [brushable, option]);

  if (summary.buckets === 0) return <>{empty ?? <Text size="sm" c="dimmed">No data points.</Text>}</>;

  return (
    <div data-testid="rollup-chart">
      <figure aria-label={`${label}. ${summary.text}`} style={{ margin: 0 }}>
        <ReactECharts option={option} style={{ height, width: '100%' }} events={events} ref={ref} theme="gen3" />
      </figure>
      <VisuallyHidden>{summary.text}</VisuallyHidden>
      {brushable ? (
        <details>
          <summary><Text component="span" size="xs">Choose a time range with the keyboard</Text></summary>
          <RangeFields points={points} grain={grain} onSelect={onRangeSelect} />
        </details>
      ) : null}
      <details>
        <summary><Text component="span" size="xs">Show data as a table</Text></summary>
        <Table.ScrollContainer minWidth={400} mah={260}>
          <Table striped withTableBorder aria-label={`${label}, data table`}>
            <Table.Thead>
              <Table.Tr><Table.Th>Bucket start</Table.Th><Table.Th>Group</Table.Th><Table.Th>Events</Table.Th><Table.Th>Distinct source IPs</Table.Th><Table.Th>Max bytes out</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {table.rows.map((r, i) => (
                <Table.Tr key={`${r.time}-${r.group}-${i}`}>
                  <Table.Td>{r.time}</Table.Td><Table.Td>{r.group}</Table.Td><Table.Td>{r.events}</Table.Td><Table.Td>{r.distinctIps === null ? '—' : r.distinctIps}</Table.Td>
                  <Table.Td>{r.bytesMax === null ? <Text span size="sm" c="dimmed" fs="italic">not recorded</Text> : r.bytesMax}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {table.total > table.rows.length ? <Text size="xs" c="dimmed">Showing the first {table.rows.length} of {table.total} buckets.</Text> : null}
      </details>
    </div>
  );
};


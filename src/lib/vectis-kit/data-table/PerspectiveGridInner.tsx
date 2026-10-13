/**
 * The real Perspective grid. Loaded only through PerspectiveGrid (next/dynamic, ssr:false): it needs WebAssembly,
 * Web Workers and custom elements, none of which exist during server rendering or in jsdom.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Group, Skeleton, Switch } from '@mantine/core';
import { ErrorCard, SegmentedControl } from '@gen3/frontend';
import { PerspectiveViewer } from '@perspective-dev/react';
import type { ViewerConfigUpdate } from '@perspective-dev/viewer';
import type { Client } from '@perspective-dev/client';
import type { ColumnMeta, SortSpec } from '../spec';
import { getPerspectiveClient } from './perspectiveRuntime';
// After the runtime, so the Gen3 theme is declared later than Perspective's own themes.css.
import styles from '@/styles/siem-perspective-theme.module.css';
import type { PerspectiveGridProps } from './PerspectiveGrid';
import { sanitizeLayout, toColumnar } from './tableModel';

/** `name` is the Perspective table the viewer shows. Each response gets a fresh name; the previous table is deleted. */
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; client: Client; name: string };

const dirOf = (d: unknown): 'asc' | 'desc' | null => (d === 'asc' ? 'asc' : d === 'desc' ? 'desc' : null);

const CHARTS: { label: string; plugin: string }[] = [
  { label: 'Table', plugin: 'Datagrid' }, { label: 'Bar', plugin: 'Y Bar' }, { label: 'Line', plugin: 'Y Line' },
  { label: 'Area', plugin: 'Y Area' }, { label: 'Scatter', plugin: 'Y Scatter' }, { label: 'Heatmap', plugin: 'Heatmap' },
];

/** Count rows per timestamp bucket (time charts) or per value of the first text column (the rest). Never invents a measure. */
function chartDefaults(plugin: string, columns: string[], meta: ColumnMeta[]): Record<string, unknown> {
  const type = (c: string) => meta.find((m) => m.name === c)?.type;
  const time = columns.find((c) => type(c) === 'timestamp');
  const text = columns.find((c) => type(c) !== 'timestamp' && type(c) !== 'integer' && type(c) !== 'float') ?? columns[0];
  const measure = columns.find((c) => c !== time && c !== text) ?? columns[0];
  const timeChart = plugin === 'Y Line' || plugin === 'Y Area' || plugin === 'Y Bar';
  if (timeChart && time) {
    return { expressions: { 'time bucket': `bucket("${time}", 'h')` }, group_by: ['time bucket'], split_by: [], columns: [measure], aggregates: { [measure]: 'count' } };
  }
  return { group_by: text ? [text] : [], split_by: [], columns: measure ? [measure] : [], aggregates: measure ? { [measure]: 'count' } : {} };
}

const PerspectiveGridInner = ({ columns, rows, meta, layout, sort, onSortChange, onRowClick, height = 600, label = 'Data grid' }: PerspectiveGridProps) => {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const current = useRef<{ client: Client; name: string } | null>(null);
  const seq = useRef(0);
  const schemaKey = columns.join('\u0000');
  const layoutKey = JSON.stringify(layout ?? null);
  const [userConfig, setUserConfig] = useState<ViewerConfigUpdate>({});
  const [options, setOptions] = useState(false);
  const plugin = typeof userConfig.plugin === 'string' ? userConfig.plugin : 'Datagrid';

  // A different column set or a newly applied saved view starts from that view's layout, not the previous one's.
  useEffect(() => {
    setUserConfig(sanitizeLayout(layout, columns) as ViewerConfigUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaKey, layoutKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await getPerspectiveClient();
        const { schema, data } = toColumnar(columns, rows, meta);
        const name = `rows-${(seq.current += 1)}`;
        const table = await client.table(schema, { name });
        await table.update(data);
        if (cancelled) { void table.delete({ lazy: true }); return; }
        const previous = current.current;
        current.current = { client, name };
        setState({ kind: 'ready', client, name });
        if (previous) void previous.client.open_table(previous.name).then((t) => t.delete({ lazy: true })).catch(() => undefined);
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: e instanceof Error ? e.message : 'The grid could not start.' });
      }
    })();
    return () => { cancelled = true; };
  }, [columns, rows, meta, attempt]);

  useEffect(() => () => {
    const last = current.current;
    current.current = null;
    if (last) void last.client.open_table(last.name).then((t) => t.delete({ lazy: true })).catch(() => undefined);
  }, []);

  const tableName = state.kind === 'ready' ? state.name : null;
  const config = useMemo<ViewerConfigUpdate>(
    () => ({
      plugin: 'Datagrid', title: label, ...userConfig, settings: options,
      ...(sort ? { sort: [[sort.field, sort.dir ?? 'desc']] } : {}),
      table: tableName,
    }) as ViewerConfigUpdate,
    [userConfig, sort, tableName, label, options],
  );

  if (state.kind === 'error') {
    return (
      <div role="alert" data-testid="grid-error">
        <ErrorCard message={`The grid could not start. ${state.message}`} />
        <Button mt="xs" size="xs" variant="default" onClick={() => { setState({ kind: 'loading' }); setAttempt((a) => a + 1); }}>Try again</Button>
      </div>
    );
  }
  if (state.kind === 'loading') return <Skeleton role="status" height={height} radius="sm" aria-busy="true" aria-label="Loading the grid" data-testid="grid-loading" />;

  const choose = (next: string) => {
    setUserConfig((prev) => {
      const base = { ...prev } as Record<string, unknown>;
      for (const k of ['expressions', 'group_by', 'split_by', 'columns', 'aggregates']) delete base[k];
      return (next === 'Datagrid' ? { ...base, plugin: next } : { ...base, ...chartDefaults(next, columns, meta), plugin: next }) as ViewerConfigUpdate;
    });
    setOptions(next !== 'Datagrid' && options);
  };

  return (
    <div>
      <Group justify="space-between" mb="xs" gap="xs">
        <SegmentedControl size="xs" padding={2} aria-label="Show as" value={CHARTS.find((c) => c.plugin === plugin)?.plugin ?? 'Datagrid'}
          onChange={choose} data={CHARTS.map((c) => ({ label: c.label, value: c.plugin }))} />
        <Switch size="xs" label="Group, split and aggregate" checked={options} onChange={(e) => setOptions(e.currentTarget.checked)} />
      </Group>
    <div role="region" aria-label={label} data-testid="perspective-grid" data-row-count={rows.length} style={{ height, width: '100%' }}>
      <PerspectiveViewer
        client={state.client}
        config={config}
        className={styles.gen3Theme}
        style={{ height: '100%', width: '100%' }}
        onConfigUpdate={(c) => {
          const rest = { ...c };
          delete rest.table; // the table name is ours to set, never the user's
          setUserConfig(rest);
          const first = Array.isArray(c.sort) ? (c.sort[0] as unknown[] | undefined) : undefined;
          const next: SortSpec | null = first && typeof first[0] === 'string' && dirOf(first[1]) ? { field: first[0], dir: dirOf(first[1])! } : null;
          if (next?.field !== sort?.field || next?.dir !== sort?.dir) onSortChange?.(next);
        }}
        onClick={(detail) => {
          if (!onRowClick) return;
          const hit = rows.find((r) => Object.entries(detail.row ?? {}).every(([k, v]) => v === null || v === undefined || typeof v === 'object' || String(r[k]) === String(v) || typeof r[k] === 'string' && Date.parse(String(r[k])) === Number(v)));
          if (hit) onRowClick(hit);
        }}
      />
    </div>
    </div>
  );
};

export default PerspectiveGridInner;

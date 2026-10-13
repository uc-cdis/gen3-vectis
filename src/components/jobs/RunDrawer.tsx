import React, { useState } from 'react';
import { Accordion, Alert, Badge, Button, Code, Drawer, Group, Modal, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import type { Run } from '@/lib/jobs/model';
import { JobsApiError } from '@/lib/jobs/api';
import { useJobsApi, useJobsInvalidate, useJobsQuery } from '@/lib/jobs/api/hooks';
import { CopyValue } from '@/lib/vectis-kit/entity-card/blocks';
import Time from '@/lib/vectis-kit/ui/Time';
import { formatBytes, formatDuration } from '@/lib/vectis-kit/ui/format';
import { EmptyState, LoadingState, Panel } from '@/lib/vectis-kit/ui/primitives';
import { CopyIcon } from '@/lib/vectis-kit/ui/primitives';
import { ErrorState, StateBadge, TextBlock } from './common';
import { FlowDiagram } from './FlowDiagram';
import { flowFromRun } from './flow';
import type { PollPhase } from './model';
import { DRAWER_POLL, isCancellable, isTerminal, lastLines, resourcesText } from './model';

const Dash = () => <Text span size="sm" c="dimmed">—</Text>;

function cancelMessage(e: unknown): string {
  if (e instanceof JobsApiError && e.status === 403) return 'You can view jobs but are not allowed to cancel them.';
  if (e instanceof JobsApiError && e.status >= 400 && e.status < 500) return e.message;
  return 'The run could not be canceled because of a problem on the server. Try again in a moment.';
}

const FailureBanner = ({ t }: { t: Run }) => {
  if (t.state !== 'failed') return null;
  const own = t.steps.findIndex((l) => l.state === 'failed'); // a workflow runner reports each step's own state
  const idx = own >= 0 ? own : t.steps.findIndex((l) => l.exit_code !== null && l.exit_code !== 0);
  const bad = idx >= 0 ? t.steps[idx] : undefined;
  const label = bad ? (bad.name ? `Step "${bad.name}"` : `Step ${idx + 1}`) : '';
  const tail = bad ? lastLines(bad.stderr || bad.error || '') : lastLines([t.error ?? '', ...(t.system_logs ?? [])].filter(Boolean).join('\n'));
  return (
    <Alert color="red" role="alert" title={bad ? 'A step of this run failed' : 'The run failed'} data-testid="failure-banner">
      <Text size="sm">{bad ? (bad.exit_code !== null ? `${label} exited with code ${bad.exit_code}.` : `${label} failed.`) : 'Exit code: —'}</Text>
      {tail ? <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, fontFamily: 'var(--mantine-font-family-monospace)' }}>{tail}</pre> : null}
    </Alert>
  );
};

/** A step that started but whose logs the server did not fetch (a workflow with many steps): load them when the user asks. */
const LoadLogs = ({ run, step }: { run: Run; step: Run['steps'][number] }) => {
  const api = useJobsApi();
  const [state, setState] = useState<{ stdout: string; stderr: string; truncated: boolean } | 'loading' | 'failed' | null>(null);
  const load = async () => {
    setState('loading');
    try {
      const r = await api.getRun(run.id, 'full', undefined, [step.name]);
      const s = r.steps.find((x) => x.name === step.name);
      setState(s ? { stdout: s.stdout, stderr: s.stderr, truncated: s.truncated } : 'failed');
    } catch { setState('failed'); }
  };
  if (state && typeof state === 'object') {
    return (
      <Stack gap="sm">
        <TextBlock label={`Step ${step.name} stdout`} text={state.stdout} truncated={state.truncated} />
        <TextBlock label={`Step ${step.name} stderr`} text={state.stderr} />
      </Stack>
    );
  }
  return (
    <Group>
      <Button size="xs" variant="default" onClick={() => void load()} loading={state === 'loading'} data-testid="load-logs">Load logs for {step.name}</Button>
      {state === 'failed' ? <Text size="xs" c="red.8" role="alert">The logs could not be loaded.</Text> : null}
    </Group>
  );
};

const Logs = ({ t }: { t: Run }) => {
  const steps = t.steps.filter((x) => x.started_at || x.stdout || x.stderr || x.exit_code !== null);
  if (!steps.length) return <Text size="sm" c="dimmed">No logs yet.</Text>;
  return (
    <Tabs defaultValue={String(steps[0].index)} keepMounted={false}>
      <Tabs.List aria-label="Step logs">{steps.map((x) => <Tabs.Tab key={x.index} value={String(x.index)}>{x.name || `Step ${x.index + 1}`}</Tabs.Tab>)}</Tabs.List>
      {steps.map((x) => (
        <Tabs.Panel key={x.index} value={String(x.index)} pt="sm">
          {x.logs_loaded ? <Stack gap="sm">
            <TextBlock label={`${x.name ? `Step ${x.name}` : `Step ${x.index + 1}`} stdout`} text={x.stdout} truncated={x.truncated} />
            <TextBlock label={`${x.name ? `Step ${x.name}` : `Step ${x.index + 1}`} stderr`} text={x.stderr} />
            {x.error && x.state === 'failed' ? <TextBlock label={`Step ${x.name || x.index + 1} error`} text={x.error} /> : null}
          </Stack> : <LoadLogs run={t} step={x} />}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
};

const Files = ({ t }: { t: Run }) => {
  return (
    <Stack gap="md">
      <Panel title="Inputs">
        {t.inputs.length ? (
          <Table aria-label="Inputs" withRowBorders>
            <Table.Thead><Table.Tr><Table.Th>Path</Table.Th><Table.Th>URL</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{t.inputs.map((i, k) => (
              <Table.Tr key={k}><Table.Td><Text size="sm" ff="monospace">{i.path}</Text></Table.Td><Table.Td>{i.url ? <CopyValue value={i.url} what="input url" /> : <Dash />}</Table.Td></Table.Tr>
            ))}</Table.Tbody>
          </Table>
        ) : <Text size="sm" c="dimmed">No inputs.</Text>}
      </Panel>
      <Panel title="Outputs">
        {t.outputs.length ? (
          <Table aria-label="Outputs" withRowBorders>
            <Table.Thead><Table.Tr><Table.Th>Path</Table.Th><Table.Th>URL</Table.Th><Table.Th>Size</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{t.outputs.map((o, k) => (
              <Table.Tr key={k}>
                <Table.Td><Text size="sm" ff="monospace">{o.path}</Text></Table.Td>
                <Table.Td><CopyValue value={o.url} what="output url" /></Table.Td>
                <Table.Td><Text size="sm">{o.size_bytes !== null ? formatBytes(o.size_bytes) : '—'}</Text></Table.Td>
              </Table.Tr>
            ))}</Table.Tbody>
          </Table>
        ) : <Text size="sm" c="dimmed">No outputs.</Text>}
      </Panel>
    </Stack>
  );
};

const Body = ({ t, onCancel }: { t: Run; onCancel: () => void }) => {
  const tags = Object.entries(t.tags);
  const sys = t.system_logs ?? [];
  return (
    <Stack gap="md">
      <FailureBanner t={t} />
      <Group gap="xl" align="flex-start">
        <Stack gap={0}><Text size="xs" c="dimmed">Created</Text><Time iso={t.created_at} /></Stack>
        <Stack gap={0}><Text size="xs" c="dimmed">Started</Text><Time iso={t.started_at} /></Stack>
        <Stack gap={0}><Text size="xs" c="dimmed">Ended</Text><Time iso={t.ended_at} /></Stack>
        <Stack gap={0}><Text size="xs" c="dimmed">Duration</Text><Text size="sm">{formatDuration(t.started_at, t.ended_at)}</Text></Stack>
      </Group>
      {t.description ? <Text size="sm">{t.description}</Text> : null}
      <Panel title="Flow"><FlowDiagram nodes={flowFromRun(t)} label={`Steps of ${t.name || t.id}`} /></Panel>
      {t.params && Object.keys(t.params).length ? (
        <Panel title="Parameters">
          <Table aria-label="Parameters" withRowBorders>
            <Table.Tbody>{Object.entries(t.params).map(([k, v]) => <Table.Tr key={k}><Table.Td><Text size="sm" ff="monospace">{k}</Text></Table.Td><Table.Td><Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>{v}</Text></Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        </Panel>
      ) : null}
      {t.backend === 'dagu' ? null : <Panel title="Resources"><Text size="sm">{resourcesText(t.resources)}</Text></Panel>}
      <Panel title="Tags">
        {tags.length ? <Group gap={6}>{tags.map(([k, v]) => <Badge key={k} variant="light" color="gray" radius="sm" tt="none">{k}: {v}</Badge>)}</Group> : <Text size="sm" c="dimmed">No tags.</Text>}
      </Panel>
      {t.backend === 'dagu' && !t.inputs.length && !t.outputs.length ? null : <Files t={t} />}
      <Panel title="Logs"><Logs t={t} /></Panel>
      <Accordion variant="contained">
        <Accordion.Item value="system">
          <Accordion.Control>System logs ({sys.length})</Accordion.Control>
          <Accordion.Panel>{sys.length ? <TextBlock label="System logs" text={sys.join('\n')} /> : <Text size="sm" c="dimmed">No system logs.</Text>}</Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      {isCancellable(t.state) ? <Group><Button color="red" variant="light" onClick={onCancel}>Cancel run</Button></Group> : null}
    </Stack>
  );
};

const CancelDialog = ({ t, onClose, onDone }: { t: Run; onClose: () => void; onDone: () => void }) => {
  const api = useJobsApi();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setPending(true); setErr(null);
    try { await api.cancelRun(t.id); onDone(); } catch (e) { setErr(cancelMessage(e)); } finally { setPending(false); }
  };
  return (
    <Modal opened onClose={onClose} title="Cancel this run?" centered returnFocus>
      <Stack>
        <Text size="sm">Cancel <b>{t.name || t.id}</b>? Work in progress is stopped and cannot be resumed.</Text>
        {err ? <Alert color="red" role="alert" data-testid="cancel-error">{err}</Alert> : null}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={pending}>Keep running</Button>
          <Button color="red" onClick={() => void go()} loading={pending} disabled={pending}>Cancel run</Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const RunDrawer = ({ id, onClose, schedule = DRAWER_POLL }: { id: string; onClose: () => void; schedule?: readonly PollPhase[] }) => {
  const invalidate = useJobsInvalidate();
  const q = useJobsQuery<Run>('run', [id, 'full'], (a) => a.getRun(id, 'full'), {
    poll: { phases: schedule, active: (d) => !!d && !isTerminal(d.state) }, // this run only; stops once it finishes or the drawer closes
  });
  const [confirm, setConfirm] = useState(false);
  const t = q.data;
  return (
    <Drawer
      opened onClose={onClose} position="right" size="xl" returnFocus closeOnEscape={!confirm}
      title={(
        <Stack gap={2} aria-label={`Run ${id}`}>
          <Group gap="xs">
            <Title order={4} component="span" style={{ overflowWrap: 'anywhere' }}>{t ? t.name || t.id : 'Run'}</Title>
            {t ? <StateBadge run={t} /> : null}
            {t?.job ? <Code>{t.job}</Code> : null}
          </Group>
          <Group gap={4}><Text size="xs" c="dimmed">Run id</Text><Code>{id}</Code><CopyIcon value={id} what="run id" /></Group>
        </Stack>
      )}
    >
      {q.error && !t ? (q.error.status === 404 ? <EmptyState title="This run was not found" hint="It may belong to another user, or it may have been removed." /> : <ErrorState error={q.error} onRetry={() => void q.refresh()} />)
        : !t ? <LoadingState rows={5} />
        : (
          <Stack gap="md">
            {q.error ? <ErrorState error={q.error} onRetry={() => void q.refresh()} /> : null}
            {q.paused ? (
              <Alert color="yellow" role="status" data-testid="paused-note">
                <Group justify="space-between"><Text size="sm">Paused: refresh to resume</Text><Button size="xs" variant="default" onClick={() => void q.refresh()}>Refresh</Button></Group>
              </Alert>
            ) : null}
            <Body t={t} onCancel={() => setConfirm(true)} />
          </Stack>
        )}
      {t && confirm ? <CancelDialog t={t} onClose={() => setConfirm(false)} onDone={() => { setConfirm(false); void q.refresh(); void invalidate('runs'); }} /> : null}
    </Drawer>
  );
};

export default RunDrawer;

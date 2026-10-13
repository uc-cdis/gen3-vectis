import type { CatalogDef, JobDef } from '@/lib/jobs/jobdef/types';
import { isDagDef } from '@/lib/jobs/jobdef/types';
import type { Run } from '@/lib/jobs/model';
import type { FlowNode, FlowStatus } from './FlowDiagram';
import { argvText, isTerminal } from './model';

const count = (n: number, one: string) => (n === 0 ? `No ${one}s` : `${n} ${one}${n === 1 ? '' : 's'}`);

const STATE_TEXT: Record<string, { status: FlowStatus; text: string }> = {
  succeeded: { status: 'success', text: 'Succeeded' }, failed: { status: 'failure', text: 'Failed' }, running: { status: 'running', text: 'Running' },
  queued: { status: 'neutral', text: 'Waiting' }, starting: { status: 'running', text: 'Starting' }, cancelled: { status: 'neutral', text: 'Did not run' }, unknown: { status: 'neutral', text: 'Unknown' },
};

/** A workflow run (steps have names and dependency edges): one node per step, joined by the DAG's own edges. No inputs/outputs boxes. */
export function dagFlowFromRun(r: Run): FlowNode[] {
  const keys = new Set(r.steps.map((s) => `step:${s.name}`));
  return r.steps.map((x) => {
    let m = STATE_TEXT[x.state ?? 'unknown'];
    // Found with a real Dagu: after a cancel, the step that never started still said "Waiting" and the one that was
    // running said "Did not run". In a finished run nothing is waiting, and a step that had started was stopped, not skipped.
    if (isTerminal(r.state) && x.state === 'queued') m = { status: 'neutral', text: 'Did not run' };
    else if (x.state === 'cancelled' && x.started_at) m = { status: 'neutral', text: 'Cancelled' };
    return {
      key: `step:${x.name}`, kind: 'step' as const, title: x.name, subtitle: x.image || undefined,
      status: m.status, statusText: x.state === 'failed' && x.exit_code !== null ? `Failed (exit ${x.exit_code})` : m.text,
      deps: x.depends_on.map((d) => `step:${d}`).filter((k) => keys.has(k)),
    };
  });
}

/** A run as a flow: inputs, then each step with its exit code when known, then outputs. A workflow run is drawn as a DAG. */
export function flowFromRun(r: Run): FlowNode[] {
  if (r.steps.length > 0 && r.steps.every((s) => s.name !== '')) return dagFlowFromRun(r);
  const nodes: FlowNode[] = [{
    key: 'in', kind: 'inputs', title: count(r.inputs.length, 'input'), items: r.inputs.map((i) => i.path),
  }];
  r.steps.forEach((x, i) => {
    let status: FlowStatus = 'neutral';
    let statusText = 'Exit code: —';
    if (x.exit_code !== null) { status = x.exit_code === 0 ? 'success' : 'failure'; statusText = x.exit_code === 0 ? 'Succeeded (exit 0)' : `Failed (exit ${x.exit_code})`; }
    else if (x.started_at && !x.ended_at && !isTerminal(r.state)) { status = 'running'; statusText = 'Running'; }
    nodes.push({ key: `step${i}`, kind: 'step', title: `Step ${i + 1}`, subtitle: x.image || '—', code: argvText(x.command), status, statusText });
  });
  nodes.push({ key: 'out', kind: 'outputs', title: count(r.outputs.length, 'output'), items: r.outputs.map((o) => o.path) });
  return nodes;
}

/** A catalog definition as a flow (nothing has run, so no status). A workflow job is drawn from its (linted) graph. */
export function flowFromDef(d: CatalogDef): FlowNode[] {
  if (isDagDef(d)) {
    const g = d.graph ?? [];
    return g.map((x) => ({ key: `step:${x.name}`, kind: 'step' as const, title: x.name, subtitle: x.executor || undefined, deps: x.depends_on.map((n) => `step:${n}`) }));
  }
  return flowFromContainerDef(d);
}
function flowFromContainerDef(d: JobDef): FlowNode[] {
  return [
    { key: 'in', kind: 'inputs', title: count(d.inputs?.length ?? 0, 'input'), items: (d.inputs ?? []).map((i) => `${i.name}: ${i.path}`) },
    { key: 'step0', kind: 'step', title: 'Step 1', subtitle: d.image, code: argvText(d.command) },
    ...(d.executors_after ?? []).map((x, i): FlowNode => ({ key: `step${i + 1}`, kind: 'step', title: `Step ${i + 2}`, subtitle: x.image, code: argvText(x.command) })),
    { key: 'out', kind: 'outputs', title: count(d.outputs?.length ?? 0, 'output'), items: (d.outputs ?? []).map((o) => `${o.name}: ${o.path}`) },
  ];
}

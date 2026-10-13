/* oxlint-disable jest/valid-expect -- vitest's expect(value, message) labels a failure inside a loop; the jest rule does not know it */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFixtureApi } from '@/lib/jobs/api/fixtureApi';
import type { Run } from '@/lib/jobs/model';
import { FlowDiagram, layoutDag } from './FlowDiagram';
import type { FlowNode } from './FlowDiagram';
import { dagFlowFromRun, flowFromDef, flowFromRun } from './flow';
import RunDrawer from './RunDrawer';
import { apiWith, renderJobs, task } from './testUtils';

const n = (key: string, deps?: string[]): FlowNode => ({ key, kind: 'step', title: key, deps });
const FAST = [{ untilMs: 600_000, everyMs: 30 }];

describe('layoutDag', () => {
  it('layers by longest path, stacks parallel branches, and the order is a valid topological order', () => {
    const p = layoutDag([n('join', ['a', 'b', 'c']), n('a', []), n('b', []), n('c', []), n('d', ['join']), n('x', ['d', 'a'])]);
    const pos = Object.fromEntries(p.map((x) => [x.key, x]));
    expect([pos.a.col, pos.b.col, pos.c.col, pos.join.col, pos.d.col, pos.x.col]).toEqual([0, 0, 0, 1, 2, 3]);
    expect([pos.a.row, pos.b.row, pos.c.row]).toEqual([0, 1, 2]);
    const order = p.map((x) => x.key);
    for (const [k, deps] of [['join', ['a', 'b', 'c']], ['d', ['join']], ['x', ['d', 'a']]] as const) for (const d of deps) expect(order.indexOf(d), `${d} before ${k}`).toBeLessThan(order.indexOf(k));
  });
  it('ignores unknown dependencies and survives a cycle (the server refuses cycles; this is only a guard)', () => {
    expect(layoutDag([n('a', ['ghost']), n('b', ['a'])]).map((x) => x.col)).toEqual([0, 1]);
    expect(layoutDag([n('a', ['b']), n('b', ['a'])])).toHaveLength(2);
    expect(layoutDag([n('a', ['a'])])).toEqual([{ key: 'a', col: 0, row: 0 }]);
    expect(layoutDag([])).toEqual([]);
  });
});

describe('FlowDiagram', () => {
  it('draws a DAG: one list item per step in topological DOM order, arrows only between dependent steps', () => {
    renderJobs(<FlowDiagram label="Steps of X" nodes={[n('join', ['a', 'b']), n('a', []), n('b', []), n('lonely', [])]} />);
    const list = screen.getByRole('list', { name: 'Steps of X' });
    expect(list).toHaveAttribute('data-layout', 'dag');
    const items = Array.from(list.children) as HTMLElement[];
    const keys = items.map((i) => i.getAttribute('data-step'));
    expect(keys.indexOf('a')).toBeLessThan(keys.indexOf('join'));
    expect(keys.indexOf('b')).toBeLessThan(keys.indexOf('join'));
    const edges = Array.from(screen.getByTestId('flow-edges').querySelectorAll('[data-edge]')).map((e) => e.getAttribute('data-edge')).sort();
    expect(edges).toEqual(['a>join', 'b>join']); // nothing for 'lonely', nothing between siblings
    expect(items.find((i) => i.getAttribute('data-step') === 'join')).toHaveAttribute('aria-label', expect.stringContaining('After a, b'));
    expect(screen.getByTestId('flow-edges')).toHaveAttribute('aria-hidden', 'true'); // the arrows are decoration; the dependencies are in the text
  });
  it('the scroll container is a keyboard-reachable region', () => {
    renderJobs(<FlowDiagram label="Steps of X" nodes={[n('a', [])]} />);
    expect(screen.getByRole('region', { name: /Steps of X/ })).toHaveAttribute('tabindex', '0');
  });
  it('the linear TES rendering is unchanged (no deps -> inputs/steps/outputs with arrows between neighbours)', async () => {
    renderJobs(<RunDrawer id="t-1" onClose={() => undefined} schedule={FAST} />, apiWith({ getRun: vi.fn(async () => task()) }));
    const flow = await screen.findByRole('list', { name: /Steps of Test run/ });
    expect(flow).not.toHaveAttribute('data-layout');
    expect((Array.from(flow.children) as HTMLElement[]).map((i) => i.getAttribute('data-node'))).toEqual(['inputs', 'step', 'outputs']);
    expect(screen.queryByTestId('flow-edges')).toBeNull();
  });
});

describe('flows from runs and definitions', () => {
  const run = async (id: string): Promise<Run> => createFixtureApi({ delayMs: 0 }).getRun(id, 'full');
  it('a workflow run becomes a DAG with each step\'s own status; a TES run does not', async () => {
    const r = await run('fanout.fx0002');
    const nodes = dagFlowFromRun(r);
    expect(nodes.map((x) => [x.key, x.status, x.deps])).toEqual([
      ['step:branch_a', 'success', []], ['step:branch_b', 'failure', []], ['step:branch_c', 'success', []],
      ['step:join', 'neutral', ['step:branch_a', 'step:branch_b', 'step:branch_c']],
    ]);
    expect(nodes[1].statusText).toBe('Failed (exit 3)');
    expect(nodes[3].statusText).toBe('Did not run');
    expect(flowFromRun(r)).toEqual(nodes);
    expect(flowFromRun(task()).every((x) => x.deps === undefined)).toBe(true);
  });
  it('a cancelled workflow: the step that was running says Cancelled, one that never started says Did not run (seen with a real Dagu)', () => {
    const step = (name: string, state: 'succeeded' | 'cancelled' | 'queued', started: string | null, depends_on: string[]) => ({ ...task().steps[0], name, state, started_at: started, depends_on });
    const r = { ...task(), state: 'cancelled' as const, steps: [step('warmup', 'succeeded', '2026-10-12T10:00:00Z', []), step('nap', 'cancelled', '2026-10-12T10:00:01Z', ['warmup']), step('wake', 'queued', null, ['nap'])] };
    expect(dagFlowFromRun(r).map((x) => x.statusText)).toEqual(['Succeeded', 'Cancelled', 'Did not run']);
    expect(dagFlowFromRun({ ...r, state: 'running', steps: r.steps.slice(1).map((x) => ({ ...x, state: x.name === 'nap' ? 'running' as const : 'queued' as const })) }).map((x) => x.statusText)).toEqual(['Running', 'Waiting']);
  });
  it('a workflow definition is drawn from its linted graph, with the executor as the subtitle', () => {
    const def = createFixtureApi({ delayMs: 0 }).catalog().then((c) => c.jobs.find((j) => j.def.id === 'dag-soc-enrich')!.def);
    return def.then((d) => {
      const nodes = flowFromDef(d);
      expect(nodes.map((x) => [x.title, x.subtitle, x.deps])).toEqual([['enrich', 'http.request', []], ['shape', 'jq.filter', ['step:enrich']], ['notify', 'http.request', ['step:shape']]]);
    });
  });
});

describe('RunDrawer for a workflow run', () => {
  const open = async (id: string) => {
    const t = await createFixtureApi({ delayMs: 0 }).getRun(id, 'full');
    renderJobs(<RunDrawer id={id} onClose={() => undefined} schedule={FAST} />, apiWith({ getRun: vi.fn(async () => t) }));
    return t;
  };
  it('shows the DAG with a failed branch, a failure banner naming the step, per-step logs and the parameters', async () => {
    await open('fanout.fx0002');
    const flow = await screen.findByRole('list', { name: /Steps of fanout/ });
    expect(flow).toHaveAttribute('data-layout', 'dag');
    const items = Array.from(flow.children) as HTMLElement[];
    expect(items.map((i) => i.getAttribute('data-status'))).toEqual(expect.arrayContaining(['success', 'failure', 'neutral']));
    const banner = screen.getByTestId('failure-banner');
    expect(banner).toHaveTextContent('Step "branch_b" exited with code 3');
    expect(banner).toHaveTextContent('upstream returned 503');
    const params = screen.getByRole('table', { name: 'Parameters' });
    expect(within(params).getByText('label')).toBeInTheDocument();
    expect(within(params).getByText('weekly')).toBeInTheDocument();
    expect(screen.queryByText('Resources')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'branch_b' }));
    expect(screen.getByLabelText('Step branch_b stderr')).toHaveTextContent('upstream returned 503');
  });
  it('a running workflow run offers Cancel', async () => {
    await open('soc-enrich-indicator.fx0003');
    expect(await screen.findByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
  });
});

describe('RunDrawer: logs that were not fetched are loaded on demand', () => {
  it('offers "Load logs" for a started step without logs and fetches exactly that step', async () => {
    const base = await createFixtureApi({ delayMs: 0 }).getRun('fanout.fx0001', 'full');
    const unloaded: Run = { ...base, steps: base.steps.map((s) => (s.name === 'branch_a' ? { ...s, stdout: '', stderr: '', logs_loaded: false } : s)) };
    const getRun = vi.fn(async (_id: string, _d: string, _sig?: AbortSignal, steps?: readonly string[]) => (steps?.length ? { ...base } : unloaded));
    renderJobs(<RunDrawer id={base.id} onClose={() => undefined} schedule={FAST} />, apiWith({ getRun: getRun as never }));
    const btn = await screen.findByTestId('load-logs');
    expect(btn).toHaveTextContent('Load logs for branch_a');
    await userEvent.click(btn);
    expect(await screen.findByLabelText('Step branch_a stdout')).toHaveTextContent('branch a for nightly');
    expect(getRun).toHaveBeenCalledWith(base.id, 'full', undefined, ['branch_a']);
  });
});

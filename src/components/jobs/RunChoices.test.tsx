import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAG_FIXTURE_DEFS } from '@/lib/jobs/api/fixtureApi';
import type { RunsQuery } from '@/lib/jobs/api';
import RunDialog from './RunDialog';
import RunDrawer from './RunDrawer';
import RunsTab from './RunsTab';
import YamlTab from './YamlTab';
import { apiWith, renderJobs, task } from './testUtils';

const fan = DAG_FIXTURE_DEFS.find((d) => d.id === 'dag-fanout')!;
const FAST = [{ untilMs: 1_000, everyMs: 50 }] as const;

describe('naming a run and running it as a group', () => {
  it('sends the name and the chosen group with the submit', async () => {
    const submitJob = vi.fn(async () => ({ id: 'fanout.fx9', warnings: [] }));
    renderJobs(<RunDialog job={fan} repo="o/r" sha={'a'.repeat(40)} onClose={() => undefined} onSubmitted={vi.fn()} />, apiWith({ submitJob, groups: async () => ['soc', 'platform'] }));
    await userEvent.type(screen.getByLabelText(/Name this run/), '  Friday WAF review ');
    await userEvent.click((await screen.findAllByLabelText('Run as'))[0]);
    await userEvent.click(await screen.findByText('Group: soc'));
    expect(screen.getByText(/Everyone in the soc group will see this run/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Run job' }));
    await waitFor(() => expect(submitJob).toHaveBeenCalled());
    expect((submitJob.mock.calls[0] as unknown[])[0]).toMatchObject({ job: 'dag-fanout', title: 'Friday WAF review', group: 'soc' });
  });
  it('sends neither when left alone, and shows no group choice when the person is in no group', async () => {
    const submitJob = vi.fn(async () => ({ id: 'fanout.fx9', warnings: [] }));
    renderJobs(<RunDialog job={fan} repo="o/r" sha={'a'.repeat(40)} onClose={() => undefined} onSubmitted={vi.fn()} />, apiWith({ submitJob, groups: async () => [] }));
    expect(screen.queryAllByLabelText('Run as')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Run job' }));
    await waitFor(() => expect(submitJob).toHaveBeenCalled());
    const sent = (submitJob.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('title');
    expect(sent).not.toHaveProperty('group');
  });
  it('the paste tab offers the same choices and sends them', async () => {
    const submitYaml = vi.fn(async () => ({ id: 'adhoc.fx1', warnings: [] }));
    renderJobs(<YamlTab onSubmitted={vi.fn()} />, apiWith({ submitYaml, groups: async () => ['soc'], serviceInfo: async () => ({ name: 'Dagu' }) }));
    await userEvent.click(screen.getByLabelText('Definition (YAML)'));
    await userEvent.paste('steps: []');
    await userEvent.type(screen.getByLabelText(/Name this run/), 'Quick check');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(submitYaml).toHaveBeenCalled());
    expect(submitYaml).toHaveBeenCalledWith('steps: []', undefined, { title: 'Quick check' });
  });
});

describe('the list', () => {
  const rows = [
    task({ id: 'a1', name: 'fanout', tags: { 'vectis.job': 'x' } }),
  ];
  it('shows a run\'s name with its job name beneath, a group badge and an archived badge', async () => {
    const listRuns = vi.fn(async () => ({ runs: [{ ...rows[0], title: 'Friday WAF review', group: 'soc' }, { ...rows[0], id: 'a2', name: 'old', archived: true }], next_page_token: null }));
    renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST} />, apiWith({ listRuns, groups: async () => ['soc'] }));
    expect(await screen.findByText('Friday WAF review')).toBeInTheDocument();
    expect(screen.getByTestId('group-badge')).toHaveTextContent('Group: soc');
    expect(screen.getByTestId('archived-badge')).toBeInTheDocument();
    expect(screen.getByLabelText('Open run Friday WAF review')).toBeInTheDocument();
  });
  it('offers whose runs only to a person who has groups, and asks for them by scope', async () => {
    const calls: RunsQuery[] = [];
    const listRuns = vi.fn(async (q: RunsQuery) => { calls.push(q); return { runs: rows, next_page_token: null }; });
    const { unmount } = renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST} />, apiWith({ listRuns, groups: async () => [] }));
    await screen.findAllByText('fanout');
    expect(screen.queryAllByLabelText('Whose runs')).toHaveLength(0);
    unmount();
    renderJobs(<RunsTab onOpen={() => undefined} schedule={FAST} />, apiWith({ listRuns, groups: async () => ['soc'] }));
    await userEvent.click((await screen.findAllByLabelText('Whose runs'))[0]);
    await userEvent.click(await screen.findByText('Only my groups\''));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'shared' })));
  });
});

describe('the run drawer', () => {
  it('explains an archived run, and names a run', async () => {
    const getRun = vi.fn(async () => ({ ...task({ id: 'a1', name: 'fanout', state: 'COMPLETE' }), archived: true }));
    const renameRun = vi.fn(async () => ({ ...task({ id: 'a1', name: 'fanout' }), title: 'My name' }));
    renderJobs(<RunDrawer id="a1" onClose={() => undefined} schedule={FAST} />, apiWith({ getRun, renameRun, runResults: async () => [] }));
    expect(await screen.findByTestId('archived-note')).toHaveTextContent(/no longer has this run/);
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull(); // nothing to cancel: the server does not have it
    await userEvent.click(screen.getByLabelText('Name this run'));
    const dialog = await screen.findByRole('dialog', { name: /Name this run/ });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'My name');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(renameRun).toHaveBeenCalledWith('a1', 'My name'));
  });
});

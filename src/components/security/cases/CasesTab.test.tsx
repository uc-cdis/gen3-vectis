import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig, mutate } from 'swr';
import { ApiError } from '@/lib/vectis-kit/api';
import type { CallInput, RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { CaseList, CaseNote, CaseRecord } from '@/lib/vectis-kit/spec';
import { getMockQuery } from '@/test/nextRouterMock';
import { renderSecurity } from '../testing/render';
import CasesTab from '../tabs/CasesTab';

// SWR keeps a global cache (the mutation hook invalidates that one), so empty it before each test and switch off
// request de-duplication so a request from the previous test's API is never reused.
beforeEach(async () => { await mutate(() => true, undefined, { revalidate: false }); });
const mount = (api?: SiemApi) => renderSecurity(<SWRConfig value={{ dedupingInterval: 0 }}><CasesTab /></SWRConfig>, { url: '/Security?tab=cases', api });

type Override = (input: CallInput<RouteName>, base: SiemApi) => unknown;
/** A fixture API with some routes replaced, recording every call. */
function wrap(overrides: Partial<Record<RouteName, Override>>): SiemApi & { calls: { name: RouteName; input: CallInput<RouteName> | undefined }[]; base: SiemApi } {
  const base = createFixtureApi(0);
  const calls: { name: RouteName; input: CallInput<RouteName> | undefined }[] = [];
  return {
    mode: 'fixtures', calls, base,
    async call(name, input) {
      calls.push({ name, input: input as CallInput<RouteName> | undefined });
      const o = overrides[name];
      if (o) return (await o(input as CallInput<RouteName>, base)) as never;
      return base.call(name, input);
    },
  };
}

const mk = (id: string, priority: CaseRecord['priority'], extra: Partial<CaseRecord> = {}): CaseRecord => ({
  case_id: id, title: `Case ${id}`, description: '', status: 'open', priority, assignee: null, tags: [], group_ids: [], notes: [],
  created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z', etag: `${id}-1`, ...extra,
});

describe('Cases list', () => {
  it('shows status, priority, assignee, alert count and updated, sorted by priority rank', async () => {
    // Alphabetical order would be critical, high, low, medium: only rank order puts medium before low.
    const list: CaseList = { total: 4, cases: [mk('c-low', 'low'), mk('c-med', 'medium'), mk('c-crit', 'critical'), mk('c-high', 'high', { group_ids: ['g-1', 'g-2'], assignee: 'ann' })] };
    mount(wrap({ cases: () => list }));
    await screen.findByText('Case c-crit');
    const rows = within(screen.getByRole('table', { name: 'Cases' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('button').textContent)).toEqual(['Case c-crit', 'Case c-high', 'Case c-med', 'Case c-low']);
    const high = rows[1]!;
    expect(within(high).getByText('High')).toBeInTheDocument();
    expect(within(high).getByText('ann')).toBeInTheDocument();
    expect(within(high).getByText('2')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Unassigned')).toBeInTheDocument();
  });

  it('re-sorts by rank when the priority header is clicked', async () => {
    const list: CaseList = { total: 3, cases: [mk('c-a', 'low'), mk('c-b', 'critical'), mk('c-c', 'medium')] };
    mount(wrap({ cases: () => list }));
    await screen.findByText('Case c-a');
    const header = screen.getByRole('columnheader', { name: /Priority/ });
    await userEvent.click(within(header).getByText('Priority'));
    const names = () => within(screen.getByRole('table', { name: 'Cases' })).getAllByRole('row').slice(1).map((r) => within(r).getByRole('button').textContent);
    await waitFor(() => expect(names()).toEqual(['Case c-a', 'Case c-c', 'Case c-b']));
  });

  it('shows a loading state, then an error state when the API rejects, with a retry', async () => {
    let fail = true;
    mount(wrap({ cases: (_i, base) => (fail ? Promise.reject(new ApiError(500, 'boom', 'cases')) : base.call('cases')) }));
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/boom/);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Web application intrusion (sample)')).toBeInTheDocument();
  });

  it('shows an empty state with no cases', async () => {
    mount(wrap({ cases: () => ({ cases: [], total: 0 }) }));
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(/No cases yet/);
  });
});

describe('Case file', () => {
  const open = async (api?: SiemApi, title = 'Web application intrusion (sample)') => {
    mount(api);
    await userEvent.click(await screen.findByRole('button', { name: `Open case ${title}` }));
    await screen.findByTestId('case-file');
  };

  it('renders analyst and AI notes differently, with provenance collapsed until asked for', async () => {
    await open();
    const analyst = await screen.findByTestId('note-analyst');
    const agent = screen.getByTestId('note-agent');
    expect(within(analyst).getByText('Analyst note')).toBeInTheDocument();
    expect(within(analyst).queryByText('AI-generated')).toBeNull();
    expect(within(agent).getByText('AI-generated')).toBeInTheDocument();
    expect(within(agent).queryByText('Analyst note')).toBeNull();
    expect(within(agent).getByText('analyst-model-v1')).toBeInTheDocument();
    expect(within(agent).queryByText('sha256:3b1f0c')).toBeNull();
    const toggle = within(agent).getByRole('button', { name: 'Show provenance' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(within(agent).getByText('sha256:3b1f0c')).toBeInTheDocument();
    expect(within(agent).getByText('sha256:9d2e71')).toBeInTheDocument();
    expect(within(agent).getByRole('button', { name: 'Hide provenance' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps agent and analyst markup as text and never marks an impersonating agent as an analyst', async () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script> **bold**';
    const notes: CaseNote[] = [
      { note_id: 'n-1', author: 'analyst1', author_kind: 'agent', at: '2026-10-09T00:00:00Z', body: evil, model: 'm<b>x</b>', prompt_hash: '<i>h</i>', input_digest: null },
      { note_id: 'n-2', author: 'bob', author_kind: 'analyst', at: '2026-10-09T01:00:00Z', body: evil, model: null, prompt_hash: null, input_digest: null },
    ];
    const list: CaseList = { total: 1, cases: [mk('c-x', 'high', { notes })] };
    const { container } = mount(wrap({ cases: () => list, caseGet: () => list.cases[0] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open case Case c-x' }));
    const agent = await screen.findByTestId('note-agent');
    expect(within(agent).getByText('AI-generated')).toBeInTheDocument();
    expect(within(agent).getByText(evil)).toBeInTheDocument();
    expect(within(agent).getByText('m<b>x</b>')).toBeInTheDocument();
    expect(within(screen.getByTestId('note-analyst')).getByText(evil)).toBeInTheDocument();
    expect(container.querySelector('img, script, b, i')).toBeNull();
  });

  it('has an AI analyst slot with a disabled Generate summary control that says the gateway is not configured', async () => {
    await open();
    const btn = await screen.findByRole('button', { name: 'Generate summary' });
    expect(btn).toBeDisabled();
    expect(screen.getAllByText(/AI gateway is not configured/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 AI-generated note/)).toBeInTheDocument();
  });

  it('opens a linked alert through the shared context', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Open alert g-ntseq-exfil' }));
    await waitFor(() => expect(getMockQuery().alert).toBe('g-ntseq-exfil'));
  });

  it('saves an edit as a conditional patch containing the etag and only the changed fields', async () => {
    const api = wrap({});
    await open(api);
    const title = await screen.findByRole('textbox', { name: /Title/ });
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed case');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved.');
    const patch = api.calls.find((c) => c.name === 'casePatch')!;
    expect(patch.input?.body).toEqual({ expected_etag: 'e-0001-3', title: 'Renamed case' });
    expect(patch.input?.params).toEqual({ id: 'case-0001' });
  });

  it('refuses to save an empty title and sends nothing', async () => {
    const api = wrap({});
    await open(api);
    const title = await screen.findByRole('textbox', { name: /Title/ });
    await userEvent.clear(title);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('A title is required.')).toBeInTheDocument();
    expect(api.calls.some((c) => c.name === 'casePatch')).toBe(false);
  });

  it('on a 412 says the case changed since it was opened, does not overwrite, and Reload shows the other change', async () => {
    const api = wrap({});
    await open(api);
    const title = await screen.findByRole('textbox', { name: /Title/ });
    // someone else edits the case after we opened it
    await api.base.call('casePatch', { params: { id: 'case-0001' }, body: { expected_etag: 'e-0001-3', title: 'Edited by a colleague' } });
    await userEvent.clear(title);
    await userEvent.type(title, 'My edit');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const conflict = await screen.findByTestId('conflict');
    expect(conflict).toHaveTextContent(/changed since you opened it/);
    expect(screen.queryByText('Changes saved.')).toBeNull();
    // the server copy is untouched by our edit
    expect((await api.base.call('caseGet', { params: { id: 'case-0001' } })).title).toBe('Edited by a colleague');
    await userEvent.click(within(conflict).getByRole('button', { name: 'Reload case' }));
    await waitFor(() => expect(screen.queryByTestId('conflict')).toBeNull());
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('Edited by a colleague'));
  });

  it('adds a note through add_note with the etag, and shows it as an analyst note', async () => {
    const api = wrap({});
    await open(api);
    await userEvent.type(await screen.findByRole('textbox', { name: /Add a note/ }), 'Checked the logs <b>twice</b>');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(screen.getAllByTestId('note-analyst')).toHaveLength(2));
    expect(api.calls.find((c) => c.name === 'casePatch')!.input?.body).toEqual({ expected_etag: 'e-0001-3', add_note: 'Checked the logs <b>twice</b>' });
    expect(screen.getByText('Checked the logs <b>twice</b>')).toBeInTheDocument();
  });

  it('rejects an empty note and a 412 on add-note shows the same conflict message', async () => {
    const api = wrap({});
    await open(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('A note cannot be empty.')).toBeInTheDocument();
    await api.base.call('casePatch', { params: { id: 'case-0001' }, body: { expected_etag: 'e-0001-3', priority: 'high' } });
    await userEvent.type(screen.getByRole('textbox', { name: /Add a note/ }), 'late note');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByTestId('conflict')).toHaveTextContent(/changed since you opened it/);
  });

  it('shows an error state when the case cannot be loaded', async () => {
    const api = wrap({ caseGet: () => Promise.reject(new ApiError(404, 'Case not found.', 'caseGet')) });
    await open(api);
    expect(await screen.findByTestId('error-state')).toHaveTextContent(/Case not found/);
  });
});

describe('Create case', () => {
  const openDialog = async (api?: SiemApi) => {
    mount(api);
    await screen.findByText('Web application intrusion (sample)');
    await userEvent.click(screen.getByRole('button', { name: 'Create case' }));
    return screen.findByRole('dialog');
  };

  it('requires a title', async () => {
    const api = wrap({});
    const dlg = await openDialog(api);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create case' }));
    expect(await within(dlg).findByText('A title is required.')).toBeInTheDocument();
    expect(api.calls.some((c) => c.name === 'caseCreate')).toBe(false);
  });

  it('rejects a 257 character title', async () => {
    const api = wrap({});
    const dlg = await openDialog(api);
    await userEvent.click(within(dlg).getByRole('textbox', { name: /Title/ }));
    await userEvent.paste('a'.repeat(257));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create case' }));
    expect(await within(dlg).findByText(/at most 256/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.name === 'caseCreate')).toBe(false);
  });

  it('rejects 21 tags', async () => {
    const api = wrap({});
    const dlg = await openDialog(api);
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Title/ }), 'Valid title');
    const tags = within(dlg).getByLabelText(/Tags/);
    await userEvent.click(tags);
    await userEvent.paste(Array.from({ length: 21 }, (_, i) => `t${i}`).join(','));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create case' }));
    expect(await within(dlg).findByText(/At most 20 tags/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.name === 'caseCreate')).toBe(false);
  });

  it('creates a case from valid input and opens it', async () => {
    const api = wrap({});
    const dlg = await openDialog(api);
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Title/ }), '  New incident ');
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Assignee/ }), 'carol');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create case' }));
    await screen.findByTestId('case-file');
    expect(api.calls.find((c) => c.name === 'caseCreate')!.input?.body).toEqual({ title: 'New incident', priority: 'medium', assignee: 'carol' });
    expect(await screen.findByRole('textbox', { name: /Title/ })).toHaveValue('New incident');
  });

  it('shows the server error and keeps the dialog open when creation fails', async () => {
    const dlg = await openDialog(wrap({ caseCreate: () => Promise.reject(new ApiError(403, 'no', 'caseCreate')) }));
    await userEvent.type(within(dlg).getByRole('textbox', { name: /Title/ }), 'X');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Create case' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(/access/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/vectis-kit/api';
import { FIXTURES } from '@/lib/vectis-kit/api/fixtureApi';
import { getMockQuery } from '@/test/nextRouterMock';
import { apiWith } from '../alerts/testUtils';
import { renderSecurity } from '../testing/render';
import AlertDrawer from './AlertDrawer';

const mount = (id: string, opts: Parameters<typeof apiWith>[0] = {}) => {
  const t = apiWith(opts);
  const onClose = () => undefined;
  renderSecurity(<AlertDrawer groupId={id} onClose={onClose} />, { url: `/Security?tab=alerts&alert=${id}`, api: t.api });
  return t;
};
const render_ = (id: string) => { const t = apiWith(); return renderSecurity(<AlertDrawer groupId={id} onClose={() => undefined} />, { url: `/Security?tab=alerts&alert=${id}`, api: t.api }); };
const pick = (label: string) => screen.getAllByLabelText(label).find((e) => e.tagName === 'INPUT')!;
const ai = (o: object) => () => o;

describe('AlertDrawer', () => {
  it('shows the header, key facts and techniques, and no evidence pointer', async () => {
    mount('g-progression-a');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Recon followed by successful exploitation from one address')).toBeInTheDocument();
    expect(within(dialog).getByText('Critical')).toBeInTheDocument();
    expect(within(dialog).getAllByText('actor-progression').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('table', { name: 'Key facts' })).toBeInTheDocument();
    // evidence_uri is drs://<bucket>/<key>, not a DRS id, so it is hidden for now.
    expect(within(dialog).queryByTestId('evidence-uri')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Copy the evidence location' })).toBeNull();
    expect(within(dialog).getAllByRole('group', { name: 'Techniques' })[0]).toHaveTextContent('T1190');
  });

  it('says where the alert came from: account, environment, feed and host, and the same for the sampled requests', async () => {
    mount('g-arg-injection');
    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findAllByText('Where it came from')).length).toBeGreaterThan(0);
    expect(await within(dialog).findAllByText(/\(\d{12}\)|gdc_f5|Data commons F5/)).not.toHaveLength(0);
    const evidence = await within(dialog).findByRole('table', { name: 'Where the requests came from' });
    expect(within(evidence).getByText('Production platform (111122223333)')).toBeInTheDocument();
    expect(within(evidence).getAllByText('portal.example.org').length).toBeGreaterThan(0);
  });

  it('shows the plain-language verdict in the sticky summary at the top of the drawer', async () => {
    mount('g-ioc-match');
    const summary = await screen.findByTestId('alert-summary');
    await waitFor(() => expect(within(summary).getByTestId('summary-verdict')).toHaveTextContent(/^Known-bad address 192\.0\.2\.44 requested/));
    expect(summary).toHaveStyle({ position: 'sticky' });
    // The summary comes before the explanation and the facts in document order.
    const dialog = screen.getByRole('dialog');
    const all = [...dialog.querySelectorAll('[data-testid="alert-summary"], [data-testid="why-indicator"]')].map((n) => n.getAttribute('data-testid'));
    expect(all).toEqual(['alert-summary', 'why-indicator']);
  });

  it('states the verdict once: the explanation below does not repeat the summary', async () => {
    mount('g-ioc-match');
    const summary = await screen.findByTestId('alert-summary');
    await waitFor(() => expect(within(summary).getByTestId('summary-verdict')).toBeInTheDocument());
    const text = within(summary).getByTestId('summary-verdict').textContent ?? '';
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('why-indicator')).toBeInTheDocument());
    expect(within(dialog).queryByTestId('why-verdict')).toBeNull();
    expect((dialog.textContent ?? '').split(text).length - 1).toBe(1);
  });

  it('does not raise the alarm for an indicator-only alert that was allowed', async () => {
    mount('g-ioc-match');
    const facts = await screen.findByRole('table', { name: 'Key facts' });
    const row = within(facts).getByText('Allowed / blocked').closest('tr')!;
    expect(row).toHaveTextContent('17 allowed / 4 blocked');
    expect(screen.queryByText('Control did not stop it')).toBeNull();
  });

  it('keeps the alarm for an attack-class alert where something was allowed, and says when the control worked', async () => {
    const { unmount } = render_('g-arg-injection');
    expect((await screen.findAllByText('Control did not stop it')).length).toBeGreaterThan(0);
    unmount();
    render_('g-env-blocked');
    expect((await screen.findAllByText('Control worked')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Control did not stop it')).toBeNull();
  });

  it('shows measured bytes/z-score/novelty gaps as Unmeasured, not 0', async () => {
    mount('g-progression-a');
    const facts = await screen.findByRole('table', { name: 'Key facts' });
    const row = within(facts).getByText('Largest response').closest('tr')!;
    expect(within(row).getByTestId('unmeasured')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/\b0\b/);
  });

  it.each([
    ['g-progression-a', ['why-rule', 'why-sequence', 'why-graph']],
    ['g-novel-1', ['why-novelty']],
    ['g-ioc-match', ['why-indicator', 'why-evidence', 'why-graph']],
    ['g-ntseq-exfil', ['why-baseline', 'why-graph']],
    ['g-cs-sensitive', ['why-rule', 'why-graph']],
  ])('renders every why section for %s', async (id, kinds) => {
    mount(id);
    for (const k of kinds) expect((await screen.findAllByTestId(k)).length).toBeGreaterThan(0);
  });

  it('renders the unmeasured novelty fixture as Unmeasured', async () => {
    mount('g-drift-1');
    const n = await screen.findByTestId('why-novelty');
    expect(within(n).getByTestId('unmeasured')).toBeInTheDocument();
    expect(n.textContent).not.toMatch(/0\.\d\d/);
  });

  it('shows a clear message when there is no explanation (404)', async () => {
    mount('g-nope');
    // Both the alert and its explanation are missing: each says so, in its own place.
    await waitFor(() => {
      const text = screen.getAllByTestId('error-state').map((e) => e.textContent ?? '').join(' | ');
      expect(text).toMatch(/Alert not found/);
      expect(text).toMatch(/No explanation for this alert/);
    });
  });

  it('lists similar alerts and opens one', async () => {
    mount('g-progression-a');
    const link = await screen.findByRole('button', { name: 'Option injection in a parameter value' });
    await userEvent.click(link);
    await waitFor(() => expect(getMockQuery().alert).toBe('g-arg-injection'));
  });

  describe('AI analyst slot', () => {
    it('not_configured: explains and offers only a disabled control', async () => {
      mount('g-progression-a');
      const slot = await screen.findByTestId('ai-slot');
      await waitFor(() => expect(slot).toHaveAttribute('data-state', 'not_configured'));
      expect(slot).toHaveTextContent('The AI gateway is not configured for this tenant.');
      expect(within(slot).getByRole('button', { name: 'Summarise this alert' })).toBeDisabled();
    });
    it('running: shows progress', async () => {
      mount('g-progression-a', { alertAiSummary: ai({ state: 'running', note: null, detail: null }) });
      const slot = await screen.findByTestId('ai-slot');
      await waitFor(() => expect(slot).toHaveAttribute('data-state', 'running'));
      expect(within(slot).getByRole('status')).toHaveTextContent(/working on this alert/);
    });
    it('ready: labels the note as AI-generated with model, prompt hash and input digest, as plain text', async () => {
      const note = { ...(FIXTURES['ai.ready'] as { note: object }).note, body: 'Looks bad <b>bold</b> <img src=x onerror=alert(1)>' };
      mount('g-progression-a', { alertAiSummary: ai({ state: 'ready', note, detail: null }) });
      const slot = await screen.findByTestId('ai-slot');
      await waitFor(() => expect(slot).toHaveAttribute('data-state', 'ready'));
      expect(within(slot).getByText(/AI-generated\. Not written by an analyst/)).toBeInTheDocument();
      expect(within(slot).getByText('analyst-model-v1')).toBeInTheDocument();
      expect(within(slot).getByText('sha256:3b1f0c')).toBeInTheDocument();
      expect(within(slot).getByText('sha256:9d2e71')).toBeInTheDocument();
      expect(within(slot).getByTestId('ai-note-body')).toHaveTextContent('Looks bad <b>bold</b> <img src=x onerror=alert(1)>');
      expect(slot.querySelector('img, b')).toBeNull();
    });
    it('ready with missing provenance shows Unmeasured rather than blank', async () => {
      const note = { ...(FIXTURES['ai.ready'] as { note: object }).note, model: null, prompt_hash: null, input_digest: null };
      mount('g-progression-a', { alertAiSummary: ai({ state: 'ready', note, detail: null }) });
      const slot = await screen.findByTestId('ai-slot');
      await waitFor(() => expect(within(slot).getAllByTestId('unmeasured')).toHaveLength(3));
    });
    it('failed: shows the error text', async () => {
      mount('g-progression-a', { alertAiSummary: ai({ state: 'failed', note: null, detail: 'Gateway timed out' }) });
      const slot = await screen.findByTestId('ai-slot');
      expect(await within(slot).findByRole('alert')).toHaveTextContent('Gateway timed out');
    });
    it('shows an error state when the request itself fails', async () => {
      mount('g-progression-a', { alertAiSummary: () => { throw new ApiError(0, 'down', 'alertAiSummary'); } });
      const slot = await screen.findByTestId('ai-slot');
      expect(await within(slot).findByTestId('error-state')).toHaveTextContent('Service unavailable');
    });
  });

  describe('actions', () => {
    it('sets status with one alertPatch call', async () => {
      const t = mount('g-env-200');
      await screen.findByRole('button', { name: 'Set status' });
      expect(screen.getByRole('button', { name: 'Set status' })).toBeDisabled();
      await userEvent.click(pick('Status'));
      await userEvent.click(await screen.findByRole('option', { name: 'Investigating', hidden: true }));
      await userEvent.click(screen.getByRole('button', { name: 'Set status' }));
      await waitFor(() => expect(t.callsTo('alertPatch')).toHaveLength(1));
      expect(t.callsTo('alertPatch')[0]![1]).toMatchObject({ params: { id: 'g-env-200' }, body: { status: 'investigating' } });
      expect(await screen.findByText('Status set to Investigating.')).toBeInTheDocument();
    });

    it('marks noise only with a reason', async () => {
      const t = mount('g-env-200');
      await userEvent.click(await screen.findByRole('button', { name: 'Mark as noise…' }));
      const dlg = await screen.findByRole('dialog', { name: /Mark 1 alert as noise/ });
      expect(within(dlg).getByRole('button', { name: 'Mark as noise' })).toBeDisabled();
      await userEvent.click(within(dlg).getByRole('radio', { name: /False positive/ }));
      await userEvent.type(within(dlg).getByRole('textbox', { name: /Reason/ }), 'Blocked scanner');
      await userEvent.click(within(dlg).getByRole('button', { name: 'Mark as noise' }));
      await waitFor(() => expect(t.callsTo('alertPatch')).toHaveLength(1));
      expect(t.callsTo('alertPatch')[0]![1].body).toMatchObject({ noise: true, status: 'noise', disposition: 'false_positive', reason: 'Blocked scanner' });
    });

    it('validates the assignee before sending', async () => {
      const t = mount('g-env-200');
      await userEvent.click(await screen.findByRole('button', { name: 'Assign' }));
      expect(screen.getByText('Enter who this is assigned to.')).toBeInTheDocument();
      expect(t.callsTo('alertPatch')).toHaveLength(0);
    });

    it('creates a case and then shows its id', async () => {
      const t = mount('g-env-200');
      await userEvent.click(await screen.findByRole('button', { name: 'Create case' }));
      await waitFor(() => expect(screen.getByTestId('case-id')).toHaveTextContent(/case-\d+/));
      const call = t.callsTo('caseCreate')[0]![1].body;
      expect(call.group_ids).toEqual(['g-env-200']);
      expect(call.priority).toBe('critical');
      expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
    });

    it('records a disposition through the decision route', async () => {
      const t = mount('g-env-200');
      await screen.findByRole('button', { name: 'Record disposition' });
      await userEvent.click(pick('Disposition'));
      await userEvent.click(await screen.findByRole('option', { name: 'True positive', hidden: true }));
      // the service refuses a closing disposition without a reason (422), so the button waits for one
      expect(screen.getByRole('button', { name: 'Record disposition' })).toBeDisabled();
      await userEvent.type(screen.getByLabelText(/Comment/), 'Confirmed scanner');
      await userEvent.click(screen.getByRole('button', { name: 'Record disposition' }));
      await waitFor(() => expect(t.callsTo('decision')).toHaveLength(1));
      expect(t.callsTo('decision')[0]![1].body).toMatchObject({ group_id: 'g-env-200', disposition: 'true_positive', comment: 'Confirmed scanner' });
    });

    it('lets an unknown disposition through without a comment', async () => {
      const t = mount('g-env-200');
      await screen.findByRole('button', { name: 'Record disposition' });
      await userEvent.click(pick('Disposition'));
      await userEvent.click(await screen.findByRole('option', { name: 'Unknown', hidden: true }));
      await userEvent.click(screen.getByRole('button', { name: 'Record disposition' }));
      await waitFor(() => expect(t.callsTo('decision')).toHaveLength(1));
    });

    it('validates the watchlist entry, then submits it', async () => {
      const t = mount('g-ioc-match');
      await userEvent.click(await screen.findByRole('button', { name: 'Add indicator to watchlist' }));
      const value = screen.getByLabelText('Value');
      await userEvent.clear(value);
      await userEvent.type(value, 'not-an-ip');
      await userEvent.click(screen.getByRole('button', { name: 'Add to watchlist' }));
      expect(await screen.findByText('That is not a valid ip.')).toBeInTheDocument();
      expect(t.callsTo('watchlist')).toHaveLength(0);
      await userEvent.clear(value);
      await userEvent.type(value, '192.0.2.44');
      await userEvent.click(screen.getByRole('button', { name: 'Add to watchlist' }));
      await waitFor(() => expect(t.callsTo('watchlist')).toHaveLength(1));
      expect(t.callsTo('watchlist')[0]![1].body.entries[0]).toMatchObject({ type: 'ip', value: '192.0.2.44', confidence: 75 });
    });

    it('shows the server message on a 412 conflict', async () => {
      mount('g-env-200', { alertPatch: () => { throw new ApiError(412, 'This alert changed since you opened it. Reload and try again.', 'alertPatch'); } });
      await userEvent.type(await screen.findByRole('textbox', { name: 'Assign to' }), 'analyst3');
      await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
      const err = await screen.findByTestId('error-state');
      expect(err).toHaveTextContent('Changed by someone else');
      expect(err).toHaveTextContent('Reload and try again');
    });

    it('shows an error state when the alert lookup fails', async () => {
      mount('g-env-200', { alertGet: () => { throw new ApiError(500, 'Server exploded', 'alertGet'); } });
      const errs = await screen.findAllByTestId('error-state');
      expect(errs.some((e) => /Server exploded/.test(e.textContent ?? ''))).toBe(true);
    });

    it('find similar goes to Hunt with the alert id', async () => {
      mount('g-env-200');
      await userEvent.click(await screen.findByRole('button', { name: 'Find similar' }));
      await waitFor(() => expect(getMockQuery()).toMatchObject({ tab: 'hunt', similar: 'g-env-200' }));
    });
  });
});

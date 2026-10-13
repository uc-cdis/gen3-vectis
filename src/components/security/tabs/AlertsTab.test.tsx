import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/vectis-kit/api';
import { FIXTURES } from '@/lib/vectis-kit/api/fixtureApi';
import type { AlertsResponse } from '@/lib/vectis-kit/spec';
import { getMockQuery } from '@/test/nextRouterMock';
import { apiWith } from '../alerts/testUtils';
import { renderSecurity } from '../testing/render';
import AlertsTab from './AlertsTab';

const all = (FIXTURES['alerts.response'] as AlertsResponse).groups;
const mount = (opts: Parameters<typeof apiWith>[0] = {}) => {
  const t = apiWith(opts);
  renderSecurity(<AlertsTab />, { url: '/Security?tab=alerts', api: t.api });
  return t;
};
const dataRows = () => screen.getAllByRole('row').slice(1);

describe('AlertsTab', () => {
  it('hides low and info by default, says how many the floor hides, and the toggle reveals them', async () => {
    mount();
    await screen.findByText(/Recon followed by successful exploitation/);
    const belowFloor = all.filter((g) => g.severity === 'low' || g.severity === 'info' ).filter((g) => !g.noise).length;
    expect(belowFloor).toBeGreaterThan(0);
    expect(screen.queryByText('Slight drift in request shape')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('alerts-summary')).toHaveTextContent(new RegExp(`${belowFloor} more below the medium floor are hidden`)));
    await userEvent.click(screen.getByRole('switch', { name: 'Show low and info' }));
    expect(await screen.findByText('Slight drift in request shape')).toBeInTheDocument();
    expect(screen.getByTestId('alerts-summary')).toHaveTextContent('Showing every severity');
  });

  it('keeps noise out until asked for', async () => {
    mount();
    await screen.findByText(/Recon followed/);
    await userEvent.click(screen.getByRole('switch', { name: 'Show low and info' })); // the noise fixture is low severity
    await screen.findByText('Slight drift in request shape');
    expect(screen.queryByText(/Secret file probes, blocked by the WAF/)).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Include noise' }));
    expect(await screen.findByText(/Secret file probes, blocked by the WAF/)).toBeInTheDocument();
  });

  it('sends the window, floor and defaults in the request', async () => {
    const t = mount();
    await screen.findByText(/Recon followed/);
    const body = t.callsTo('alerts').map((c) => c[1].body).find((b: { paging: { limit: number } }) => b.paging.limit === 50);
    expect(body).toMatchObject({ min_severity: 'medium', include_noise: false, sort: 'severity' });
    expect(Date.parse(body.window.end)).toBeGreaterThan(Date.parse(body.window.start));
  });

  it('sorts the severity column by rank, not by the string', async () => {
    mount();
    await screen.findByText(/Recon followed/);
    await userEvent.click(screen.getByRole('switch', { name: 'Show low and info' }));
    await screen.findByText('Slight drift in request shape');
    const header = screen.getByRole('columnheader', { name: /Severity/ });
    await userEvent.click(within(header).getByText('Severity'));
    const rank = ['Info', 'Low', 'Medium', 'High', 'Critical'];
    const sev = () => dataRows().map((r) => within(r).getAllByRole('cell')[1]?.textContent ?? '');
    // descending by rank starts at Critical and ends at Low (a string sort would put Medium first)
    expect(sev()[0]).toBe('Critical');
    expect(sev().at(-1)).toBe('Low');
    expect(sev().map((x) => rank.indexOf(x))).toEqual(sev().map((x) => rank.indexOf(x)).sort((a, b) => b - a));
    await userEvent.click(within(screen.getByRole('columnheader', { name: /Severity/ })).getByText('Severity'));
    const asc = dataRows().map((r) => within(r).getAllByRole('cell')[1]?.textContent);
    // string order would start with Critical; rank order starts with Low
    expect(asc[0]).toBe('Low');
    expect(asc.at(-1)).toBe('Critical');
    const ranks = asc.map((s) => rank.indexOf(s ?? ''));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('shows the control-worked verdict in words', async () => {
    mount();
    await screen.findByText(/Recon followed/);
    expect(screen.getAllByText('Control did not stop it').length).toBeGreaterThan(0);
  });

  it('opens the alert when a row is clicked', async () => {
    mount();
    const cell = await screen.findByText(/Option injection in a parameter value/);
    await userEvent.click(cell);
    await waitFor(() => expect(getMockQuery().alert).toBe('g-arg-injection'));
  });

  it('bulk noise needs a reason and sends exactly one alertBulk call', async () => {
    const t = mount();
    await screen.findByText(/Recon followed/);
    const boxes = screen.getAllByRole('checkbox', { name: /^Select alert/ });
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[1]!);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');
    expect(getMockQuery().alert).toBeUndefined(); // selecting does not open
    await userEvent.click(screen.getByRole('button', { name: 'Mark as noise…' }));
    const dialog = await screen.findByRole('dialog', { name: /Mark 2 alerts as noise/ });
    const confirm = within(dialog).getByRole('button', { name: 'Mark as noise' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Reason/ }), '   ');
    expect(confirm).toBeDisabled();
    expect(t.callsTo('alertBulk')).toHaveLength(0);
    // a reason alone is not enough: the triage rules need a determination too
    await userEvent.clear(within(dialog).getByRole('textbox', { name: /Reason/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Scanner traffic we already block');
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: /False positive/ }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(t.callsTo('alertBulk')).toHaveLength(1));
    const body = t.callsTo('alertBulk')[0]![1].body;
    expect(body.group_ids).toHaveLength(2);
    expect(new Set(body.group_ids).size).toBe(2);
    expect(body.patch).toEqual({ noise: true, status: 'noise', disposition: 'false_positive', reason: 'Scanner traffic we already block' });
    expect(await screen.findByText(/2 updated/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('bulk-count')).toBeNull());
  });

  it('sets status in bulk with one call and validates the assignee', async () => {
    const t = mount();
    await screen.findByText(/Recon followed/);
    await userEvent.click(screen.getAllByRole('checkbox', { name: /^Select alert/ })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    expect(screen.getByText('Enter who this is assigned to.')).toBeInTheDocument();
    expect(t.callsTo('alertBulk')).toHaveLength(0);
    await userEvent.type(screen.getByRole('textbox', { name: 'Assign to' }), 'analyst2');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(t.callsTo('alertBulk')).toHaveLength(1));
    expect(t.callsTo('alertBulk')[0]![1].body.patch).toEqual({ assignee: 'analyst2' });
  });

  it('reports partial bulk failures instead of hiding them', async () => {
    mount({ alertBulk: (i) => ({ updated: [], failed: { [(i.body as { group_ids: string[] }).group_ids[0]!]: 'Not found' } }) });
    await screen.findByText(/Recon followed/);
    await userEvent.click(screen.getAllByRole('checkbox', { name: /^Select alert/ })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Mark as noise…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Benign/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'because');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as noise' }));
    expect(await screen.findByText('Some alerts were not updated')).toBeInTheDocument();
    expect(screen.getByText(/Not found/)).toBeInTheDocument();
    expect(screen.getByTestId('bulk-count')).toBeInTheDocument(); // selection is kept so they can retry
  });

  describe('keyboard', () => {
    it('j and k move, x selects, Enter opens', async () => {
      mount();
      await screen.findByText(/Recon followed/);
      fireEvent.keyDown(document.body, { key: 'j' });
      expect(dataRows()[0]).toHaveAttribute('data-active', 'true');
      fireEvent.keyDown(document.body, { key: 'j' });
      expect(dataRows()[1]).toHaveAttribute('data-active', 'true');
      fireEvent.keyDown(document.body, { key: 'k' });
      expect(dataRows()[0]).toHaveAttribute('data-active', 'true');
      fireEvent.keyDown(document.body, { key: 'x' });
      expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected');
      fireEvent.keyDown(document.body, { key: 'x' });
      expect(screen.queryByTestId('bulk-count')).toBeNull();
      fireEvent.keyDown(document.body, { key: 'Enter' });
      await waitFor(() => expect(getMockQuery().alert).toBeTruthy());
    });

    it('ignores shortcuts while typing in an input', async () => {
      mount();
      await screen.findByText(/Recon followed/);
      await userEvent.click(screen.getAllByRole('checkbox', { name: /^Select alert/ })[0]!);
      const input = screen.getByRole('textbox', { name: 'Assign to' });
      await userEvent.type(input, 'jkx?');
      expect(input).toHaveValue('jkx?');
      expect(dataRows().some((r) => r.getAttribute('data-active') === 'true')).toBe(false);
      expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('? shows the shortcuts', async () => {
      mount();
      await screen.findByText(/Recon followed/);
      fireEvent.keyDown(document.body, { key: '?' });
      const dlg = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
      expect(within(dlg).getByText('Open the highlighted alert')).toBeInTheDocument();
    });
  });

  it('says so when the result is truncated', async () => {
    mount({ alerts: () => ({ ...(FIXTURES['alerts.response'] as AlertsResponse), groups: all.slice(0, 3), total: 900, truncated: true }) });
    await screen.findByText(/Recon followed/);
    expect(screen.getByTestId('alerts-summary')).toHaveTextContent(/truncated, showing 3 on this page/);
  });

  it('shows the empty state with a hint when nothing matches', async () => {
    mount({ alerts: () => ({ ...(FIXTURES['alerts.response'] as AlertsResponse), groups: [], total: 0, truncated: false }) });
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('No alerts match');
    expect(screen.getByRole('switch', { name: 'Show low and info' })).toBeInTheDocument(); // filters stay usable
  });

  it('shows an error state with retry when the API rejects', async () => {
    mount({ alerts: () => { throw new ApiError(0, 'down', 'alerts'); } });
    const err = await screen.findByTestId('error-state');
    expect(err).toHaveTextContent('Service unavailable');
    expect(within(err).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a conflict message when a bulk write returns 412', async () => {
    mount({ alertBulk: () => { throw new ApiError(412, 'Someone else changed these alerts. Reload and try again.', 'alertBulk'); } });
    await screen.findByText(/Recon followed/);
    await userEvent.click(screen.getAllByRole('checkbox', { name: /^Select alert/ })[0]!);
    await userEvent.type(screen.getByRole('textbox', { name: 'Assign to' }), 'a');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const err = await screen.findByTestId('error-state');
    expect(err).toHaveTextContent('Changed by someone else');
    expect(err).toHaveTextContent('Reload and try again');
  });

  it('renders hostile alert text as text', async () => {
    const evil = '<script>alert(1)</script>';
    const g = { ...all[0]!, title: evil, signature_label: '<img src=x onerror=alert(1)>', matched_indicators: ['javascript:alert(1)'] };
    mount({ alerts: () => ({ ...(FIXTURES['alerts.response'] as AlertsResponse), groups: [g], total: 1, truncated: false }) });
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderSecurity } from '@/components/security/testing/render';
import { FIXTURES } from '../api/fixtureApi';
import type { WhyResponse, WhySection } from '../spec';
import { WhyPanel } from './WhyPanel';

const sections = (id: string) => (FIXTURES[`why.${id}`] as WhyResponse).sections;
const show = (s: readonly WhySection[]) => renderSecurity(<WhyPanel sections={s} />);

describe('WhyPanel', () => {
  it('shows a rule with its provenance when it comes from a third-party pack', () => {
    show(sections('g-cs-sensitive'));
    const rule = screen.getByTestId('why-rule');
    expect(within(rule).getByText('Third-party pack')).toBeInTheDocument();
    expect(within(rule).getByText('example-rules')).toBeInTheDocument();
    expect(within(rule).getByText('f5cd0975d0bd')).toBeInTheDocument();
    expect(within(rule).getByText('MIT')).toBeInTheDocument();
  });

  it('shows a first-party rule without pack, commit or licence rows', () => {
    show(sections('g-progression-a').slice(0, 1));
    const rule = screen.getByTestId('why-rule');
    expect(within(rule).getByText('First-party rule')).toBeInTheDocument();
    expect(within(rule).queryByText('Licence')).toBeNull();
  });

  it('shows a measured baseline with the multiple', () => {
    show(sections('g-ntseq-exfil'));
    const b = screen.getByTestId('why-baseline');
    expect(within(b).getByText('21.5x')).toBeInTheDocument();
    expect(within(b).getByText('254 MB')).toBeInTheDocument();
    expect(within(b).getByText('11.8 MB')).toBeInTheDocument();
  });

  it('shows an unmeasured baseline as Unmeasured, never as zero', () => {
    show([{ kind: 'baseline', title: 'History', measured: false, observed_bytes: 0, multiple: 0 }]);
    const b = screen.getByTestId('why-baseline');
    expect(within(b).getByTestId('unmeasured')).toBeInTheDocument();
    expect(b.textContent).not.toMatch(/\b0\b/);
  });

  it('shows missing baseline fields in a measured section as Unmeasured', () => {
    show([{ kind: 'baseline', title: 'History', measured: true, observed_bytes: 5000, multiple: null }]);
    expect(within(screen.getByTestId('why-baseline')).getAllByTestId('unmeasured').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the sequence in time order with the actor and the proof flag', () => {
    const seq = sections('g-progression-a')[1] as Extract<WhySection, { kind?: 'sequence' }>;
    show([{ ...seq, stages: [...(seq.stages ?? [])].reverse() }]);
    const s = screen.getByTestId('why-sequence');
    expect(within(s).getByText('203.0.113.50')).toBeInTheDocument();
    expect(within(s).getByText(/Proof/)).toBeInTheDocument();
    const titles = within(s).getAllByText(/Secret and admin probes|Option injection answered 200|Traversal in a parameter|254 MB response/).map((n) => n.textContent);
    expect(titles[0]).toMatch(/Secret/);
    expect(titles.at(-1)).toMatch(/254 MB/);
    expect(within(s).getByText('Recon')).toBeInTheDocument();
    expect(within(s).getByText('Impact')).toBeInTheDocument();
  });

  it('does not claim proof when the flag is absent', () => {
    show([{ kind: 'sequence', title: 'Seq', measured: true, actor: '203.0.113.9', stages: [] }]);
    expect(screen.getByText('Not proven')).toBeInTheDocument();
    expect(screen.getByText('No stages were recorded.')).toBeInTheDocument();
  });

  it('shows measured novelty with distance and the differing features table', () => {
    show(sections('g-novel-1'));
    const n = screen.getByTestId('why-novelty');
    expect(within(n).getByText('0.62')).toBeInTheDocument();
    expect(within(n).getAllByTestId('novelty-neighbor')).toHaveLength(2);
    expect(within(n).getByText('distance 0.41')).toBeInTheDocument();
    const tables = within(n).getAllByRole('table', { name: 'Differing features' });
    expect(within(tables[0]!).getByText('path template')).toBeInTheDocument();
    expect(within(tables[0]!).getByText('/termdb')).toBeInTheDocument();
    expect(within(tables[1]!).getAllByText('not present').length).toBe(2);
  });

  it('shows unmeasured novelty as Unmeasured with no score', () => {
    show(sections('g-drift-1'));
    const n = screen.getByTestId('why-novelty');
    expect(within(n).getByTestId('unmeasured')).toBeInTheDocument();
    expect(within(n).queryByText(/0\.\d\d/)).toBeNull();
  });

  it('shows the matched value first, then feed, dates and the intel id as secondary', () => {
    show(sections('g-ioc-match'));
    const i = screen.getByTestId('why-indicator');
    expect(within(i).getByTestId('indicator-value')).toHaveTextContent('192.0.2.44');
    expect(within(i).getByText('IP address')).toBeInTheDocument();
    expect(within(i).getByText('example-feed')).toBeInTheDocument();
    expect(within(i).getByText('malicious-activity')).toBeInTheDocument();
    expect(within(i).getByText('Valid from').closest('tr')).toHaveTextContent(/ago|\d{4}/);
    // The id is shown, but after the value.
    const text = i.textContent ?? '';
    expect(text.indexOf('192.0.2.44')).toBeLessThan(text.indexOf('tenant1:Indicator:'));
  });

  it('says Not recorded for what the intel node does not hold, never inventing a value', () => {
    show(sections('g-ioc-match'));
    const i = screen.getByTestId('why-indicator');
    expect(within(within(i).getByText('Confidence').closest('tr')!).getByTestId('not-recorded')).toBeInTheDocument();
    expect(within(i).getByText('Confidence').closest('tr')).not.toHaveTextContent('/100');
    expect(within(i).getByText('Valid until').closest('tr')).toHaveTextContent('No end date recorded');
  });

  it('shows an unreadable indicator as its id with no claimed type, feed or dates', () => {
    show([{ kind: 'indicator', title: 'Indicator match', measured: true, matches: [{ value: 'tenant1:Indicator:gone', type: null, indicator_id: 'tenant1:Indicator:gone', revoked: false, indicator_types: [] }] }]);
    const i = screen.getByTestId('why-indicator');
    expect(within(i).getByTestId('indicator-value')).toHaveTextContent('tenant1:Indicator:gone');
    expect(i).toHaveTextContent(/could not be read from the intel table/);
    expect(within(i).getAllByTestId('not-recorded').length).toBeGreaterThanOrEqual(3);
  });

  it('puts the verdict first, then the sections, then the evidence, then the graph', () => {
    const w = FIXTURES['why.g-ioc-match'] as WhyResponse;
    const { container } = renderSecurity(<WhyPanel sections={w.sections} verdict={w.verdict} evidence={w.evidence} />);
    expect(screen.getByTestId('why-verdict')).toHaveTextContent(/^Known-bad address 192\.0\.2\.44 requested/);
    const order = [...container.querySelectorAll('[data-testid]')].map((n) => n.getAttribute('data-testid')).filter((t) => /^why-(verdict|rule|indicator|evidence|graph)$/.test(t ?? ''));
    expect(order).toEqual(['why-verdict', 'why-indicator', 'why-evidence', 'why-graph']);
  });

  it('shows the evidence: top paths, actions by rule, and what could not be measured', () => {
    const w = FIXTURES['why.g-ioc-match'] as WhyResponse;
    renderSecurity(<WhyPanel sections={w.sections} verdict={w.verdict} evidence={w.evidence} />);
    const ev = screen.getByTestId('why-evidence');
    expect(within(within(ev).getByRole('table', { name: 'Requested paths' })).getAllByRole('row').length).toBeLessThanOrEqual(5);
    const actions = within(ev).getByRole('table', { name: 'Actions taken' });
    expect(within(actions).getByText('Default_Action')).toBeInTheDocument();
    expect(within(actions).getByText('us-only-traffic')).toBeInTheDocument();
    // Status and volume are not recorded by this source: said so, not zero.
    expect(within(ev).getAllByTestId('unmeasured').length).toBeGreaterThanOrEqual(2);
    // IOC alert: counts are neutral, with no alarm wording.
    expect(within(ev).getByTestId('evidence-allowed')).toHaveTextContent('17 allowed');
    expect(ev.textContent).not.toMatch(/did not stop it/i);
  });

  it('renders hostile paths and verdict text as plain text', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const w = FIXTURES['why.g-ioc-match'] as WhyResponse;
    const evidence = { ...w.evidence!, top_paths: [{ key: evil, count: 1 }] };
    const { container } = renderSecurity(<WhyPanel sections={[]} verdict={evil} evidence={evidence} />);
    expect(screen.getAllByText(evil).length).toBe(2);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows graph neighbours and technique chips, and an unmeasured graph as Unmeasured', () => {
    const { unmount } = show(sections('g-progression-a').slice(2));
    const g = screen.getByTestId('why-graph');
    expect(within(g).getByText('T1595')).toBeInTheDocument();
    expect(within(g).getByText(/requested/)).toBeInTheDocument();
    const link = within(g).getByText('T1190').closest('a')!;
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('href', 'https://attack.mitre.org/techniques/T1190/');
    unmount();
    show(sections('g-ioc-match').slice(1));
    expect(within(screen.getByTestId('why-graph')).getByTestId('unmeasured')).toBeInTheDocument();
  });

  it('renders hostile text as text and never makes a link from a malformed technique', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = show([{ kind: 'graph', title: evil, measured: true, shared: [], techniques: ['javascript:alert(1)'] }]);
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull();
  });

  it('shows every repeated value once per occurrence, with no duplicate-key warning, when log text is the same twice', async () => {
    const { vi } = await import('vitest');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      show([{ kind: 'graph', title: 'Graph', measured: true, shared: [{ id: 'n1', label: 'dup', type: 'ip' }, { id: 'n1', label: 'dup', type: 'ip' }] as never, techniques: ['T1190', 'T1190', 'nonsense', 'nonsense'] }]);
      expect(screen.getAllByText('nonsense')).toHaveLength(2);
      expect(screen.getAllByText('T1190')).toHaveLength(2);
      const messages = spy.mock.calls.map((c) => String(c[0]) + String(c[1] ?? ''));
      expect(messages.filter((m) => /same key|unique "key"/.test(m))).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('says so for an unknown section kind and for no sections', () => {
    const { unmount } = show([{ kind: 'mystery', title: 'Odd', measured: true } as unknown as WhySection]);
    expect(screen.getByText(/not supported by this version/)).toBeInTheDocument();
    unmount();
    show([]);
    expect(screen.getByText('No explanation was recorded for this alert.')).toBeInTheDocument();
  });
});

describe('WhyPanel: who sent it and what they sent', () => {
  const actor = {
    ip: '203.0.113.9', country: 'US', network: 'AS64500 Example Hosting Ltd', requests: 10, endpoints: 9, user_agent: 'Mozilla/5.0 (X11)',
    statuses: [{ key: '2xx', count: 1 }], first_seen: '2026-10-30', last_seen: '2026-11-03', events_total: 40, targets: 7,
    related_alerts: [{ group_id: 'g-other', title: 'Probing of sensitive paths', severity: 'medium' as const, day: '2026-11-01' }],
  };

  it('names the sender, whose network it is, how long it has been known and what else fired on it', async () => {
    const opened: string[] = [];
    renderSecurity(<WhyPanel sections={[]} actors={[actor]} onOpenAlert={(id) => opened.push(id)} />);
    const panel = screen.getByTestId('why-actors');
    expect(within(panel).getByText('203.0.113.9')).toBeInTheDocument();
    expect(within(panel).getByTestId('actor-network')).toHaveTextContent('AS64500 Example Hosting Ltd');
    expect(within(panel).getByTestId('actor-activity')).toHaveTextContent('10 requests to 9 paths; responses 2xx: 1');
    expect(within(panel).getByTestId('actor-history')).toHaveTextContent('In our logs 2026-10-30 to 2026-11-03: 40 events to 7 distinct targets.');
    const related = within(panel).getByTestId('actor-related');
    expect(within(related).getByText('Medium')).toBeInTheDocument();
    within(related).getByRole('button', { name: 'Probing of sensitive paths' }).click();
    expect(opened).toEqual(['g-other']);
  });

  it('says so when no network or response status was recorded, rather than leaving a blank', () => {
    renderSecurity(<WhyPanel sections={[]} actors={[{ ip: '203.0.113.9', requests: 1, endpoints: 1 }]} />);
    const panel = screen.getByTestId('why-actors');
    expect(within(panel).getByText('network not recorded')).toBeInTheDocument();
    expect(within(panel).getByTestId('actor-activity')).toHaveTextContent('no response status recorded');
    expect(within(panel).queryByTestId('actor-history')).toBeNull();
    expect(within(panel).queryByTestId('actor-related')).toBeNull();
  });

  it('shows the sampled requests as data, with a dash where the source records no status', () => {
    renderSecurity(<WhyPanel sections={[]} requests={[
      { t: '2026-11-03T08:18:59Z', method: 'GET', path: '/c/abc', status: null as unknown as undefined, host: 'k8s-bdcatprod', user_agent: 'Mozilla/5.0' },
      { t: '2026-11-03T08:19:00Z', method: 'GET', path: '/index.html', status: 404, bytes: 135, host: 'portal.example.org' },
    ]} />);
    const panel = screen.getByTestId('why-requests');
    expect(within(panel).getByText('Untrusted data')).toBeInTheDocument();
    const rows = within(panel).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('GET /c/abc');
    expect(rows[0]).toHaveTextContent('—');
    expect(rows[1]).toHaveTextContent('404');
  });

  it('shows nothing extra for an alert that stored no evidence', () => {
    renderSecurity(<WhyPanel sections={[]} verdict="Known-bad address 203.0.113.9 requested /." />);
    expect(screen.queryByTestId('why-actors')).toBeNull();
    expect(screen.queryByTestId('why-requests')).toBeNull();
  });
});

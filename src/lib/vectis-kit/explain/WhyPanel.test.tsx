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

  it('says so for an unknown section kind and for no sections', () => {
    const { unmount } = show([{ kind: 'mystery', title: 'Odd', measured: true } as unknown as WhySection]);
    expect(screen.getByText(/not supported by this version/)).toBeInTheDocument();
    unmount();
    show([]);
    expect(screen.getByText('No explanation was recorded for this alert.')).toBeInTheDocument();
  });
});

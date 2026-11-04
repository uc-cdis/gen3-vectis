import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RouteName, SiemApi } from '@/lib/vectis-kit/api';
import { ApiError } from '@/lib/vectis-kit/api';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import { getMockQuery } from '@/test/nextRouterMock';
import { renderSecurity } from '../testing/render';

vi.mock('@gen3/frontend', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ReactECharts: () => <div data-testid="echart" />,
}));

import HuntTab from '../tabs/HuntTab';

type Body = Record<string, unknown> & { index_name?: string; window?: { start: string; end: string }; sort?: { dir: string }; filters?: { field: string; op: string; value: string }[] };
type Call = { name: RouteName; input: { body?: Body } };
type Override = (input: Call['input']) => unknown;

function spyApi(over: Partial<Record<RouteName, Override>> = {}): { api: SiemApi; calls: Call[]; of: (n: RouteName) => Call[] } {
  const base = createFixtureApi(0);
  const calls: Call[] = [];
  const api: SiemApi = {
    mode: 'fixtures',
    call: async (name, input) => {
      calls.push({ name, input: (input ?? {}) as Call['input'] });
      const o = over[name];
      return o ? (o((input ?? {}) as Call['input']) as never) : base.call(name, input);
    },
  };
  return { api, calls, of: (n) => calls.filter((c) => c.name === n) };
}

const AT = '2026-10-22T14:30:00.000Z';
const at = (seconds: number) => new Date(Date.parse(AT) + seconds * 1000).toISOString();
const LINK = `/Security?tab=hunt&inv_type=ip&inv_value=203.0.113.50&inv_at=${AT}&inv_span=5&inv_scope=actor`;

const web = (id: string, seconds: number, extra: Record<string, unknown> = {}) => ({
  id, event_time: at(seconds), source: 'waf', src_ip: '203.0.113.50', http_method: 'GET', host_header: 'a.example.org', uri_path: `/p/${id}`, status_code: 404, rule_action: 'ALLOW', ...extra,
});
/** Rows for a request, by side: before the moment newest first, after it oldest first, from a pool of events. */
// Only all_events holds the pool (an event is in one index, not several); the egress log answers empty, as it does when the entity never went through the proxy.
const answer = (pool: ReturnType<typeof web>[], only = 'all_events') => (input: Call['input']) => {
  const b = input.body!;
  if (b.index_name !== only) return { as_of: AT, columns: [], index_name: b.index_name, rows: [] };
  const start = Date.parse(b.window!.start);
  const end = Date.parse(b.window!.end);
  let rows = pool.filter((r) => Date.parse(r.event_time) >= start && Date.parse(r.event_time) < end);
  for (const f of b.filters ?? []) rows = rows.filter((r) => (r as Record<string, unknown>)[f.field] === f.value);
  rows = [...rows].sort((x, y) => (Date.parse(x.event_time) - Date.parse(y.event_time)) * (b.sort?.dir === 'desc' ? -1 : 1));
  return { as_of: AT, columns: b.columns ?? [], index_name: b.index_name, rows: rows.slice(0, (b.paging as { limit: number } | undefined)?.limit ?? 100) };
};
const reject = (status: number, message: string): Override => () => { throw new ApiError(status, message, 'rows'); };

const POOL = [
  ...Array.from({ length: 12 }, (_, i) => web(`b${i}`, -(i + 1) * 10)),
  ...Array.from({ length: 12 }, (_, i) => web(`a${i}`, (i + 1) * 10)),
  web('other', -5, { src_ip: '198.51.100.9' }),
];
const rowsCalls = (of: (n: RouteName) => Call[]) => of('rows').filter((c) => c.input.body?.paging && (c.input.body.paging as { limit: number }).limit === 10);

beforeEach(() => { vi.clearAllMocks(); });

describe('Hunt: investigate an entity around a moment', () => {
  it('shows the form and recent entities, and no timeline, until there is something to follow', async () => {
    const { api, of } = spyApi();
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    expect(await screen.findByRole('form', { name: 'Start an investigation' })).toBeInTheDocument();
    expect(screen.queryByTestId('hunt-investigation')).toBeNull();
    expect(screen.queryByText('Unified timeline')).toBeNull();
    expect(rowsCalls(of)).toHaveLength(0);
  });

  it('asks the nearest events on each side of the moment for the address, in every place it can appear', async () => {
    const { api, of } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    await screen.findByTestId('hunt-investigation');
    await waitFor(() => expect(rowsCalls(of).length).toBeGreaterThanOrEqual(2));
    const calls = rowsCalls(of).map((c) => c.input.body!);
    const first = calls.find((b) => b.index_name === 'all_events' && b.sort?.dir === 'desc')!;
    expect(first.filters).toEqual([{ field: 'src_ip', op: 'eq', value: '203.0.113.50' }]);
    expect(first.window).toEqual({ start: at(-300), end: AT });
    const after = calls.find((b) => b.index_name === 'all_events' && b.sort?.dir === 'asc')!;
    expect(after.window).toEqual({ start: AT, end: at(300) });
  });

  it('lists the ten before and the ten after in time order around a marker for the moment, each with its offset', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    const table = await screen.findByRole('table', { name: 'Events around the moment' });
    const rows = within(table).getAllByTestId('context-event');
    expect(rows).toHaveLength(20);
    expect(within(rows[0]).getByText('-1m 40s')).toBeInTheDocument();          // the oldest of the ten before: b9
    expect(within(rows[9]).getByText('-10s')).toBeInTheDocument();             // the nearest before
    expect(within(rows[10]).getByText('+10s')).toBeInTheDocument();            // the nearest after
    expect(within(rows[19]).getByText('+1m 40s')).toBeInTheDocument();
    expect(within(table).getAllByTestId('context-moment')).toHaveLength(1);
    expect(within(rows[9]).getByText(/GET a\.example\.org\/p\/b0 404 ALLOW/)).toBeInTheDocument();
    expect(within(table).queryByText(/p\/other/)).toBeNull();                  // another address's event is not in "this entity"
  });

  it('the toggle shows everything in the environment in the same minutes, and the link records it', async () => {
    const { api, of } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    await screen.findByRole('table', { name: 'Events around the moment' });
    await userEvent.click(screen.getByRole('radio', { name: 'Everything' }));
    await waitFor(() => expect(getMockQuery().inv_scope).toBe('all'));
    await waitFor(() => expect(rowsCalls(of).some((c) => c.input.body!.filters!.length === 0 && c.input.body!.index_name === 'all_events')).toBe(true));
    expect(await screen.findByTestId('context-scope')).toHaveTextContent('everything in the environment');
    const table = await screen.findByRole('table', { name: 'Events around the moment' });
    await waitFor(() => expect(within(table).getAllByText(/p\/other/).length).toBeGreaterThan(0));
  });

  it('lists and downloads everything the investigation lines up, in Data, over the same window', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    await userEvent.click(await screen.findByRole('button', { name: 'List and download all in Explore' }));
    await waitFor(() => expect(getMockQuery()).toMatchObject({ tab: 'data', hunt_index: 'all_events', hunt_from: at(-300), hunt_to: at(300) }));
    expect(JSON.parse(String(getMockQuery().hunt_filters))).toEqual([{ field: 'src_ip', op: 'eq', value: '203.0.113.50' }]);
  });

  it('a wider reach is a new request window, and the link records it', async () => {
    const { api, of } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    await screen.findByRole('table', { name: 'Events around the moment' });
    await userEvent.click((await screen.findAllByLabelText('Reach each way')).find((e) => e.tagName === 'INPUT')!);
    await userEvent.click(await screen.findByRole('option', { name: '15 minutes', hidden: true }));
    await waitFor(() => expect(getMockQuery().inv_span).toBe('15'));
    await waitFor(() => expect(rowsCalls(of).some((c) => c.input.body!.window!.start === at(-900))).toBe(true));
  });

  it('clicking an address in the events follows that address at the same moment', async () => {
    const { api, of } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: `${LINK.replace('inv_scope=actor', 'inv_scope=all')}` });
    const table = await screen.findByRole('table', { name: 'Events around the moment' });
    await userEvent.click(await within(table).findByRole('button', { name: '198.51.100.9' }));
    await waitFor(() => expect(getMockQuery()).toMatchObject({ inv_value: '198.51.100.9', inv_at: AT, inv_type: 'ip' }));
    await waitFor(() => expect(of('entityProfile').some((c) => c.input.body!.value === '198.51.100.9')).toBe(true));
  });

  it('reads as one page: the summary, then the events (the evidence) and what it did, with who else, the graph and details beside them', async () => {
    const { api, of } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    expect(await screen.findByTestId('hunt-verdict')).toBeInTheDocument();
    await waitFor(() => expect(of('entityProfile')[0]?.input.body).toMatchObject({ type: 'ip', value: '203.0.113.50' }));
    const titles = ['Summary', 'Around that moment', 'What it did'];
    for (const title of titles) expect(await screen.findByText(title, { selector: 'h2, h3, h4, h5, h6, [class*="title"], [class*="Title"]' })).toBeInTheDocument();
    const order = titles.map((t) => screen.getByText(t, { selector: 'h2, h3, h4, h5, h6, [class*="title"], [class*="Title"]' }));
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const side = screen.getByTestId('hunt-side');
    expect(within(side).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Who else', 'Ask the graph', 'Graph', 'Details']);
    expect(await within(side).findByText('Who else acts like it')).toBeInTheDocument();
  });

  it('keeps Ask the graph one click away for the entity', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    await userEvent.click(await screen.findByRole('tab', { name: 'Ask the graph' }));
    expect(await screen.findByRole('region', { name: 'Ask the graph' })).toBeInTheDocument();
  });

  it('keeps the full profile in the Details tab, and the drawn graph behind its own button in the Graph tab', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    expect(screen.queryByRole('region', { name: 'Identity' })).toBeNull();
    await userEvent.click(await screen.findByRole('tab', { name: 'Details' }));
    expect(await screen.findByRole('region', { name: 'Identity' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Graph' }));
    expect(screen.queryByTestId('entity-graph-section')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Show the graph' }));
    expect(await screen.findByTestId('entity-graph-section')).toBeInTheDocument();
  });

  it('says so when nothing happened in the window', async () => {
    const { api } = spyApi({ rows: answer([]) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    expect(await screen.findByText(/No events in this window/)).toBeInTheDocument();
  });

  it('offers to look around the entity\'s last activity when the window is empty, and moves the moment there', async () => {
    const base = createFixtureApi(0);
    const { api } = spyApi({
      rows: answer([]),
      entityProfile: async (i) => ({ ...(await base.call('entityProfile', i as never)), last_seen: '2026-10-09T05:37:00Z' }),
    });
    renderSecurity(<HuntTab />, { api, url: LINK });
    await userEvent.click(await screen.findByRole('button', { name: 'Look around that time' }));
    await waitFor(() => expect(Date.parse(String(getMockQuery().inv_at))).toBe(Date.parse('2026-10-09T05:37:00Z')));
  });

  it('shows the events it could read and says some reads failed, when only some do', async () => {
    const { api } = spyApi({ rows: (i) => (i.body!.index_name === 'network_activity' ? reject(500, 'egress broke')(i) : answer(POOL)(i)) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    const table = await screen.findByRole('table', { name: 'Events around the moment' });
    expect(within(table).getAllByTestId('context-event').length).toBe(20);
    expect(await screen.findByText(/reads failed, so some events may be missing/)).toBeInTheDocument();
  });

  it('is an error, not an empty page, when every read fails', async () => {
    const { api } = spyApi({ rows: reject(503, 'rows broke') });
    renderSecurity(<HuntTab />, { api, url: LINK });
    expect(await screen.findAllByTestId('error-state')).not.toHaveLength(0);
    expect(screen.queryByRole('table', { name: 'Events around the moment' })).toBeNull();
  });

  it('for a kind of entity no event column holds, makes no event request and says why, but still shows what is known', async () => {
    const hash = 'a'.repeat(64);
    const { api, of } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: `/Security?tab=hunt&inv_type=hash&inv_value=${hash}&inv_at=${AT}` });
    expect(await screen.findByText(/No event column holds a hash/)).toBeInTheDocument();
    expect(rowsCalls(of)).toHaveLength(0);
    await waitFor(() => expect(of('entityProfile')[0]?.input.body).toMatchObject({ type: 'hash', value: hash }));
  });

  it.each([
    ['a value with a control character', `inv_value=203.0.113.50%00`],
    ['a time that is not a time', `inv_at=soon`],
    ['an entity type that does not exist', `inv_type=banana`],
  ])('ignores a link with %s: no request, only the form', async (_n, bad) => {
    const base = `inv_type=ip&inv_value=203.0.113.50&inv_at=${AT}`;
    const key = bad.split('=')[0];
    const query = base.split('&').filter((p) => !p.startsWith(`${key}=`)).concat(bad).join('&');
    const { api, of } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: `/Security?tab=hunt&${query}` });
    await screen.findByRole('form', { name: 'Start an investigation' });
    expect(screen.queryByTestId('hunt-investigation')).toBeNull();
    expect(rowsCalls(of)).toHaveLength(0);
  });

  it('starts an investigation from the form and writes it to the link', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Start an investigation' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Entity value' }), '203.0.113.50');
    await userEvent.click(within(form).getByRole('button', { name: 'Investigate' }));
    await waitFor(() => expect(getMockQuery()).toMatchObject({ inv_type: 'ip', inv_value: '203.0.113.50', inv_scope: 'actor', inv_span: '5' }));
    expect(getMockQuery().inv_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('refuses an empty or malformed value with a message and makes no request', async () => {
    const { api, of } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Start an investigation' });
    await userEvent.click(within(form).getByRole('button', { name: 'Investigate' }));
    expect(await within(form).findByText('Enter a value to look up.')).toBeInTheDocument();
    expect(rowsCalls(of)).toHaveLength(0);
    expect(getMockQuery().inv_type).toBeUndefined();
  });
});


describe('Hunt: one box to start, and every value can be followed', () => {
  it('detects what was pasted, and a kind picked by hand is kept', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Start an investigation' });
    const box = within(form).getByRole('textbox', { name: 'Entity value' });
    const kind = () => (within(form).getAllByLabelText('Follow').find((e) => e.tagName === 'INPUT') as HTMLInputElement).value;
    await userEvent.type(box, '203.0.113.50');
    expect(kind()).toBe('IP address');
    await userEvent.clear(box);
    await userEvent.type(box, 'portal.example.org');
    expect(kind()).toBe('Domain');
    await userEvent.clear(box);
    await userEvent.type(box, 'arn:aws:iam::111122223333:role/x');
    expect(kind()).toBe('AWS ARN');
    await userEvent.clear(box);
    await userEvent.type(box, '0123456789abcdef01234567');
    expect(kind()).toBe('Alert id');
    // choosing the kind by hand ends the guessing
    await userEvent.click(within(form).getAllByLabelText('Follow').find((e) => e.tagName === 'INPUT')!);
    await userEvent.click(await screen.findByRole('option', { name: 'Domain', hidden: true }));
    await userEvent.clear(box);
    await userEvent.type(box, '203.0.113.50');
    expect(kind()).toBe('Domain');
  });

  it('starts at the entity\'s last activity unless told otherwise, and the link then carries that moment', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Start an investigation' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Entity value' }), '203.0.113.50');
    await userEvent.click(within(form).getByRole('button', { name: 'Investigate' }));
    await waitFor(() => expect(getMockQuery().inv_at).toMatch(/^\d{4}-\d{2}-\d{2}T/));
    expect(getMockQuery().inv_at).not.toBe('last');
  });

  it('an alert id searches for similar alerts instead of following an entity', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    const form = await screen.findByRole('form', { name: 'Start an investigation' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Entity value' }), '0123456789abcdef01234567');
    await userEvent.click(within(form).getByRole('button', { name: 'Investigate' }));
    await waitFor(() => expect(getMockQuery().similar).toBe('0123456789abcdef01234567'));
    expect(getMockQuery().inv_type).toBeUndefined();
  });

  it('there is no second search form: Find similar is part of the investigation', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: '/Security?tab=hunt' });
    await screen.findByRole('form', { name: 'Start an investigation' });
    expect(screen.queryByRole('form', { name: 'Find similar' })).toBeNull();
    expect(screen.queryByText('Seen recently')).toBeNull();
  });

  it('offers every followable value in an event (the host, the path), not only addresses, and following one hunts on it at the same moment', async () => {
    const { api } = spyApi({ rows: answer(POOL) });
    renderSecurity(<HuntTab />, { api, url: LINK });
    const table = await screen.findByRole('table', { name: 'Events around the moment' });
    const row = within(table).getAllByTestId('context-event')[9]!;
    await userEvent.click(within(row).getByRole('button', { name: '/p/b0' }));
    await waitFor(() => expect(getMockQuery()).toMatchObject({ inv_type: 'path', inv_value: '/p/b0' }));
  });
});

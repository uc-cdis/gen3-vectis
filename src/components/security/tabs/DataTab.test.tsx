import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSecurity } from '@/components/security/testing/render';
import { ApiError } from '@/lib/vectis-kit/api';
import type { SiemApi } from '@/lib/vectis-kit/api/client';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import DataTab from './DataTab';

// Perspective needs WebAssembly, workers and custom elements; the real grid is proven in a browser (e2e/data.spec.ts).
const gridProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('@/lib/vectis-kit/data-table/PerspectiveGrid', () => ({
  PerspectiveGrid: (p: Record<string, unknown> & { rows: unknown[]; onRowClick?: (r: Record<string, unknown>) => void }) => {
    gridProps.last = p;
    return <div data-testid="grid-mock" data-rows={p.rows.length}><button onClick={() => p.onRowClick?.(p.rows[0] as Record<string, unknown>)}>pick first row</button></div>;
  },
}));

const wrap = (over: Partial<SiemApi['call']> | ((name: string, input: unknown) => unknown)): SiemApi => {
  const base = createFixtureApi(0);
  return { mode: 'fixtures', call: ((name: string, input: unknown) => (typeof over === 'function' ? over(name, input) ?? (base.call as (n: string, i: unknown) => unknown)(name, input) : base.call(name as never, input as never))) as SiemApi['call'] };
};

describe('DataTab', () => {
  it('shows rows, the honest count, and an index selector from the catalog', async () => {
    renderSecurity(<DataTab />, { url: '/Security?tab=data' });
    await waitFor(() => expect(screen.getByTestId('grid-mock')).toBeInTheDocument());
    expect(screen.getByTestId('result-count')).toHaveTextContent('Rows 1 to 100 of 200');
    expect(screen.getAllByLabelText('Index').some((e) => (e as HTMLInputElement).value === 'HTTP activity')).toBe(true);
    expect(screen.getByText('Time: Last 24 hours')).toBeInTheDocument();
  });

  it('says "at least" when total is null, never an exact number', async () => {
    const api = wrap((name, input) => {
      if (name !== 'rows') return undefined;
      const base = createFixtureApi(0);
      return (base.call('rows', input as never) as unknown as Promise<Record<string, unknown>>).then((r) => ({ ...r, total: null, truncated: true }));
    });
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
    await waitFor(() => expect(screen.getByTestId('result-count')).toHaveTextContent('of at least 100'));
  });

  it('an enum filter makes a removable chip and narrows the request', async () => {
    const seen: unknown[] = [];
    const api = wrap((name, input) => { if (name === 'rows') seen.push(input); return undefined; });
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
    await waitFor(() => screen.getByTestId('grid-mock'));
    await userEvent.click(screen.getByRole('checkbox', { name: /^BLOCK/ }));
    await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(1));
    expect(screen.getByTestId('filter-chip')).toHaveTextContent('WAF action is BLOCK');
    await waitFor(() => expect(JSON.stringify(seen.at(-1))).toContain('"op":"eq","value":"BLOCK"'));
    await userEvent.click(screen.getByRole('button', { name: /Remove filter: WAF action is BLOCK/ }));
    await waitFor(() => expect(screen.queryByTestId('filter-chip')).toBeNull());
  });

  it('the copied Python is the query the grid is showing: same index, window, filters, columns and sort', async () => {
    const seen: { body: { index_name: string; window: { start: string; end: string }; filters: { field: string; value: unknown }[]; columns: string[]; sort?: { field: string } } }[] = [];
    const api = wrap((name, input) => { if (name === 'rows') seen.push(input as never); return undefined; });
    const written: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (s: string) => { written.push(s); } } });
    try {
      renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
      await waitFor(() => screen.getByTestId('grid-mock'));
      const copyPython = async () => {
        written.length = 0;
        await userEvent.click(screen.getByRole('button', { name: 'Use this query elsewhere' }));
        // hidden: true because the dropdown is still mid-transition (inline display) when the data page is this busy.
        const items = await screen.findAllByRole('menuitem', { hidden: true });
        await userEvent.click(items.find((e) => (e.textContent ?? '').startsWith('Copy as Python'))!);
        await waitFor(() => expect(written).toHaveLength(1));
        // Let the dropdown finish closing, or the next click on its button would close it instead of opening it.
        await waitFor(() => expect(screen.queryAllByRole('menuitem', { hidden: true })).toHaveLength(0));
        return written[0]!;
      };

      // Unfiltered: the code carries the window but no value filter. (rule_action is also a default column, so look for the value.)
      const before = await copyPython();
      expect(before).not.toContain('"BLOCK"');
      expect(before).toContain('"rule_action"');

      // Filtered in the UI: the next request, and the copied code, both carry it.
      await userEvent.click(screen.getByRole('checkbox', { name: /^BLOCK/ }));
      await waitFor(() => expect(screen.getAllByTestId('filter-chip')).toHaveLength(1));
      await waitFor(() => expect(JSON.stringify(seen.at(-1))).toContain('"op":"eq","value":"BLOCK"'));
      const body = seen.at(-1)!.body;
      const code = await copyPython();
      expect(code).toContain(`INDEX = "${body.index_name}"`);
      expect(code).toContain(body.window.start);
      expect(code).toContain(body.window.end);
      expect(code).toMatch(/"=": \{\s*"rule_action": "BLOCK",?\s*\}/);
      for (const c of body.columns) expect(code).toContain(`"${c}"`);
      expect(code).toContain(body.sort ? `SORT_FIELD, SORT_ASCENDING = "${body.sort.field}"` : 'SORT_FIELD, SORT_ASCENDING = None');

      // Remove the chip: the code goes back to unfiltered.
      await userEvent.click(screen.getByRole('button', { name: /Remove filter: WAF action is BLOCK/ }));
      await waitFor(() => expect(screen.queryByTestId('filter-chip')).toBeNull());
      expect(await copyPython()).not.toContain('"BLOCK"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('marks approximate counts with ~', async () => {
    renderSecurity(<DataTab />, { url: '/Security?tab=data' });
    await waitFor(() => expect(screen.getAllByText('~99').length).toBeGreaterThan(0));
  });

  it('marks PII columns in the columns panel and warns when one is shown', async () => {
    const base = createFixtureApi(0);
    const api = wrap((name) => {
      if (name !== 'catalog') return undefined;
      return (base.call('catalog') as Promise<{ indexes: { columns: { name: string; pii?: boolean }[] }[] }>).then((c) => {
        const col = c.indexes[0]!.columns.find((x) => x.name === 'user_agent')!;
        col.pii = true;
        (col as { default_visible?: boolean }).default_visible = true;
        return c;
      });
    });
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
    await waitFor(() => screen.getByTestId('pii-notice'));
    expect(screen.getByTestId('pii-notice')).toHaveTextContent(/PII/);
    await userEvent.click(screen.getByRole('tab', { name: /Columns/ }));
    const group = screen.getByRole('group', { name: 'Columns' });
    expect(within(group).getAllByText('PII').length).toBeGreaterThan(0);
  });

  it('does not offer the DRS pointer columns, and never asks for them', async () => {
    const base = createFixtureApi(0);
    const rowBodies: { columns: string[] }[] = [];
    const api = wrap((name, input) => {
      if (name === 'rows') rowBodies.push((input as { body: { columns: string[] } }).body);
      if (name !== 'catalog') return undefined;
      return (base.call('catalog') as unknown as Promise<{ indexes: { columns: Record<string, unknown>[] }[] }>).then((c) => {
        for (const [n, label] of [['evidence_uri', 'Evidence URI'], ['object_id', 'Object ID']] as const) {
          c.indexes[0]!.columns.push({ name: n, label, type: 'string', description: '', enum_values: null, pii: false, default_visible: true, filterable: true, sortable: true });
        }
        return c;
      });
    });
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
    await waitFor(() => expect(screen.getByTestId('grid-mock')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: /Columns/ }));
    const group = screen.getByRole('group', { name: 'Columns' });
    expect(within(group).getAllByRole('checkbox').length).toBeGreaterThan(3);
    expect(within(group).queryByText('Evidence URI')).toBeNull();
    expect(within(group).queryByText('Object ID')).toBeNull();
    expect(rowBodies.length).toBeGreaterThan(0);
    for (const b of rowBodies) expect(b.columns).not.toEqual(expect.arrayContaining(['evidence_uri']));
    for (const b of rowBodies) expect(b.columns).not.toEqual(expect.arrayContaining(['object_id']));
  });

  it('applying a saved view sets index, columns and filters', async () => {
    const view = {
      id: 'v1', title: 'Blocked only', kind: 'data', scope: 'shared',
      spec: { index_name: 'http_activity', window: { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' }, columns: ['src_ip', 'rule_action'], filters: [{ field: 'rule_action', op: 'eq', value: 'BLOCK' }] },
    };
    const seen: { body: { columns: string[]; index_name: string } }[] = [];
    const api = wrap((name, input) => { if (name === 'rows') seen.push(input as never); return name === 'views' ? Promise.resolve({ views: [view] }) : undefined; });
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
    await waitFor(() => screen.getByTestId('grid-mock'));
    await userEvent.click(screen.getByRole('tab', { name: /Views/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Blocked only/ }));
    await waitFor(() => expect(screen.getByTestId('filter-chip')).toHaveTextContent('WAF action is BLOCK'));
    await waitFor(() => expect(seen.at(-1)?.body).toMatchObject({ index_name: 'http_activity', columns: ['src_ip', 'source', 'rule_action'] }));
  });

  it('refuses to run a query with more than 20 filters and says why', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ field: 'country', op: 'eq', value: String(i) }));
    const view = { id: 'v2', title: 'Too wide', kind: 'data', scope: 'shared', spec: { index_name: 'http_activity', window: { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' }, columns: ['src_ip'], filters: many } };
    const api = wrap((name) => (name === 'views' ? Promise.resolve({ views: [view] }) : undefined));
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
    await waitFor(() => screen.getByTestId('grid-mock'));
    await userEvent.click(screen.getByRole('tab', { name: /Views/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Too wide/ }));
    await waitFor(() => expect(screen.getByTestId('filter-limit')).toHaveTextContent(/Too many filters: 21/));
    expect(screen.queryByTestId('grid-mock')).toBeNull();
  });

  it('shows an error state when the rows call fails, and an empty state for no rows', async () => {
    const failing = wrap((name) => (name === 'rows' ? Promise.reject(new ApiError(500, 'boom', 'rows')) : undefined));
    const { unmount } = renderSecurity(<DataTab />, { url: '/Security?tab=data', api: failing });
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());
    unmount();
    const empty = wrap((name, input) => (name === 'rows' ? (createFixtureApi(0).call('rows', input as never) as unknown as Promise<Record<string, unknown>>).then((r) => ({ ...r, rows: [], total: 0 })) : undefined));
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api: empty });
    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent(/No rows in this window/));
  });

  it('shows the catalog error state', async () => {
    const api = wrap((name) => (name === 'catalog' ? Promise.reject(new ApiError(403, 'no', 'catalog')) : undefined));
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
    await waitFor(() => expect(screen.getByTestId('error-state')).toHaveTextContent(/No access/));
  });

  it('shows data version "unknown" when the service gives none, never 0', async () => {
    const api = wrap((name, input) => (name === 'rows' ? (createFixtureApi(0).call('rows', input as never) as unknown as Promise<Record<string, unknown>>).then((r) => ({ ...r, source_version: null })) : undefined));
    renderSecurity(<DataTab />, { url: '/Security?tab=data', api });
    await waitFor(() => expect(screen.getByText(/data version unknown/)).toBeInTheDocument());
  });

  it('a clicked row opens detail with an entity link for addresses', async () => {
    renderSecurity(<DataTab />, { url: '/Security?tab=data' });
    await waitFor(() => screen.getByTestId('grid-mock'));
    fireEvent.click(screen.getByText('pick first row'));
    const detail = await screen.findByTestId('row-detail');
    expect(within(detail).getByRole('button', { name: /^\d+\.\d+\.\d+\.\d+$/ })).toBeInTheDocument();
  });

  describe('the filter rail', () => {
    // A catalog like the real one: dozens of columns, the useful enum ones listed late and the hash and free-text ones first.
    const bigCatalog = async () => {
      const c = await createFixtureApi(0).call('catalog');
      const first = c.indexes[0]!;
      const col = (name: string, over: Record<string, unknown>) => ({ ...first.columns.find((x) => x.name === 'host_header')!, name, label: name.replace(/_/g, ' '), default_visible: false, enum_values: undefined, ...over });
      const noise = [
        col('src_ip_hash', { type: 'string' }), col('user_agent_hash', { type: 'string' }),
        ...Array.from({ length: 30 }, (_, k) => col(`free_text_${k}`, { type: 'string' })),
      ];
      const useful = [col('severity_kind', { type: 'enum', enum_values: ['low', 'high'] }), col('waf_action_kind', { type: 'enum', enum_values: ['ALLOW', 'BLOCK'], default_visible: true })];
      return { ...c, indexes: [{ ...first, columns: [first.columns.find((x) => x.name === 'event_time')!, ...noise, ...useful] }, ...c.indexes.slice(1)] };
    };
    const mountBig = () => renderSecurity(<DataTab />, { url: '/Security?tab=data', api: wrap((name) => (name === 'catalog' ? bigCatalog() : undefined)) });
    const listed = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded') && b.closest('[data-accordion-control]') !== null).map((b) => b.textContent ?? '');

    it('lists the most useful filters first, not the hash and free-text ones', async () => {
      mountBig();
      await waitFor(() => screen.getByTestId('grid-mock'));
      const names = listed();
      expect(names[0]).toMatch(/waf action kind/);
      expect(names[1]).toMatch(/severity kind/);
      expect(names).toHaveLength(8);
      expect(names.join(' ')).not.toMatch(/hash/);
    });

    it('keeps the long tail behind "Show all N filters" and can collapse it again', async () => {
      mountBig();
      await waitFor(() => screen.getByTestId('grid-mock'));
      await userEvent.click(screen.getByRole('button', { name: 'Show all 34 filters' }));
      expect(listed()).toHaveLength(34);
      await userEvent.click(screen.getByRole('button', { name: 'Show fewer filters' }));
      expect(listed()).toHaveLength(8);
    });

    it('finds a filter by name even when it is in the long tail, and says so when none matches', async () => {
      mountBig();
      await waitFor(() => screen.getByTestId('grid-mock'));
      await userEvent.type(screen.getByRole('textbox', { name: 'Find a filter' }), 'user agent hash');
      expect(listed()).toHaveLength(1);
      expect(listed()[0]).toMatch(/user agent hash/);
      expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
      await userEvent.clear(screen.getByRole('textbox', { name: 'Find a filter' }));
      await userEvent.type(screen.getByRole('textbox', { name: 'Find a filter' }), 'zzzz');
      expect(screen.getByText('No filter is named like that.')).toBeInTheDocument();
    });

    it('keeps an applied filter listed even when it is beyond the first few', async () => {
      mountBig();
      await waitFor(() => screen.getByTestId('grid-mock'));
      await userEvent.type(screen.getByRole('textbox', { name: 'Find a filter' }), 'free text 29');
      await userEvent.click(screen.getByRole('button', { name: /free text 29/ }));
      await userEvent.type(await screen.findByRole('textbox', { name: 'free text 29 value' }), 'abc');
      await userEvent.click(screen.getByRole('button', { name: 'Apply free text 29 filter' }));
      await userEvent.clear(screen.getByRole('textbox', { name: 'Find a filter' }));
      expect(listed().some((n) => /free text 29/.test(n))).toBe(true);
    });

    it('scrolls on its own: each panel is a named, focusable region with a bounded height', async () => {
      mountBig();
      await waitFor(() => screen.getByTestId('grid-mock'));
      const regions = screen.getAllByRole('region', { name: 'Filters' });
      expect(regions[0]).toHaveAttribute('tabindex', '0');
      for (const name of ['Columns', 'Views']) {
        await userEvent.click(screen.getByRole('tab', { name: new RegExp(name) }));
        expect(screen.getAllByRole('region', { name }).length).toBeGreaterThan(0);
      }
      const wrapper = regions[0]!.closest('[data-testid="rail-panel"]') as HTMLElement;
      expect(wrapper.style.maxHeight).toMatch(/calc\(/);   // bounded: the page never grows with the list
    });

    it('searches columns too', async () => {
      mountBig();
      await waitFor(() => screen.getByTestId('grid-mock'));
      await userEvent.click(screen.getByRole('tab', { name: /Columns/ }));
      await userEvent.type(screen.getByRole('textbox', { name: 'Find a column' }), 'free text 7');
      expect(within(screen.getByRole('group', { name: 'Columns' })).getAllByRole('checkbox')).toHaveLength(1);
    });

    it('stacks the rail above the results on a narrow screen, with no sticky position', async () => {
      mountBig();
      await waitFor(() => screen.getByTestId('grid-mock'));
      const rail = screen.getByTestId('filter-rail');
      expect(rail.style.position).not.toBe('sticky');
      expect(screen.getByTestId('data-layout').style.flexWrap).toBe('wrap');
    });
  });
});

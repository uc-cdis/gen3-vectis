import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderSecurity } from '../testing/render';
import { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';
import type { SiemApi } from '@/lib/vectis-kit/api';
import { getMockQuery } from '@/test/nextRouterMock';
import { RowDetail } from './DataTab';

const meta = [{ name: 'uri_path', label: 'URI path', type: 'string' }, { name: 'text_meta', label: 'Text meta', type: 'string' }] as never;
const SHA = 'c'.repeat(64);

describe('RowDetail', () => {
  it('shows a long cell with its true length and opens it in place', () => {
    const path = `/a/${'x'.repeat(2000)}`;
    renderSecurity(<RowDetail row={{ uri_path: path }} columns={['uri_path']} meta={meta} onClose={() => {}} />);
    expect(screen.getByTestId('expandable-length')).toHaveTextContent('2,003 characters');
    fireEvent.click(screen.getByRole('button', { name: /show full/i }));
    expect(screen.getByTestId('expandable-full').textContent).toBe(path);
  });
  it('notes what the writer changed, from text_meta or textMeta', () => {
    for (const key of ['text_meta', 'textMeta']) {
      const { unmount } = renderSecurity(<RowDetail row={{ uri_path: '/a', [key]: JSON.stringify({ uriPath: { len: 70000, sha256: SHA, truncated: true } }) }} columns={['uri_path']} meta={meta} onClose={() => {}} />);
      expect(screen.getByTestId('text-meta-note')).toHaveTextContent(`uriPath: cut at the storage limit. Original 70,000 characters, sha256 ${SHA}`);
      unmount();
    }
  });
  it('says unreadable for a malformed text_meta and shows no note when there is none', () => {
    const { unmount } = renderSecurity(<RowDetail row={{ uri_path: '/a', text_meta: '{oops' }} columns={['uri_path']} meta={meta} onClose={() => {}} />);
    expect(screen.getByTestId('text-meta-note')).toHaveTextContent('unreadable');
    unmount();
    renderSecurity(<RowDetail row={{ uri_path: '/a' }} columns={['uri_path']} meta={meta} onClose={() => {}} />);
    expect(screen.queryByTestId('text-meta-note')).toBeNull();
  });
  it('opens an investigation on the row\'s address at the row\'s time', () => {
    const cols = [{ name: 'src_ip', label: 'Source', type: 'ip' }, { name: 'event_time', label: 'Time', type: 'timestamp' }] as never;
    renderSecurity(<RowDetail row={{ src_ip: '203.0.113.9', event_time: '2026-10-22T14:30:00Z' }} columns={['src_ip', 'event_time']} meta={cols} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Investigate in Hunt' }));
    expect(getMockQuery()).toMatchObject({ tab: 'hunt', inv_type: 'ip', inv_value: '203.0.113.9', inv_at: '2026-10-22T14:30:00.000Z', inv_scope: 'actor' });
  });
  it('offers "Who was on this machine?" for an event from one of our machines and opens its sessions', () => {
    const cols = [{ name: 'src_ip', label: 'Source', type: 'ip' }, { name: 'event_time', label: 'Time', type: 'timestamp' }] as never;
    renderSecurity(<RowDetail row={{ src_ip: '10.128.4.44', event_time: '2026-11-02T03:00:00Z' }} columns={['src_ip', 'event_time']} meta={cols} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Who was on this machine?' }));
    const q = getMockQuery();
    expect(q).toMatchObject({ tab: 'data', hunt_index: 'process_activity', hunt_from: '2026-11-01T15:00:00.000Z', hunt_to: '2026-11-02T03:01:00.000Z' });
    expect(JSON.parse(q.hunt_filters as string)).toEqual([
      { field: 'activity', op: 'eq', value: 'ssm_session' },
      { field: 'hostname', op: 'eq', value: 'ip-10-128-4-44' },
    ]);
  });
  it('does not offer it for an address outside our network', () => {
    const cols = [{ name: 'src_ip', label: 'Source', type: 'ip' }, { name: 'event_time', label: 'Time', type: 'timestamp' }] as never;
    renderSecurity(<RowDetail row={{ src_ip: '198.51.100.7', event_time: '2026-11-02T03:00:00Z' }} columns={['src_ip', 'event_time']} meta={cols} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Who was on this machine?' })).toBeNull();
  });
  it('offers no investigation for a row without an address and a time', () => {
    renderSecurity(<RowDetail row={{ uri_path: '/a' }} columns={['uri_path']} meta={meta} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Investigate in Hunt' })).toBeNull();
  });

  describe('every field of the event', () => {
    const window = { start: '2026-11-01T00:00:00Z', end: '2026-11-02T00:00:00Z' };
    const many = Array.from({ length: 130 }, (_, i) => ({ name: `col_${i}`, label: `Col ${i}`, type: 'string' })) as never;
    const apiWith = (full: Record<string, unknown>) => {
      const bodies: { columns: string[]; filters: { field: string; value: string }[] }[] = [];
      const base = createFixtureApi(0);
      const api: SiemApi = {
        mode: 'fixtures',
        call: async (name, input) => {
          if (name !== 'rows') return base.call(name, input);
          const body = (input as { body: { columns: string[]; filters: { field: string; value: string }[] } }).body;
          bodies.push(body);
          return { as_of: window.end, index_name: 'http_activity', columns: body.columns, rows: [Object.fromEntries(body.columns.map((c) => [c, full[c] ?? null]))] } as never;
        },
      };
      return { api, bodies };
    };

    it('offers the button only for a row that has an id and an index to read it from', () => {
      renderSecurity(<RowDetail row={{ uri_path: '/a' }} columns={['uri_path']} meta={meta} onClose={() => {}} full={{ index: 'http_activity', window }} />);
      expect(screen.queryByRole('button', { name: 'Show every field' })).toBeNull();
    });

    it('reads the event by id in slices of at most 60 columns and shows what has a value, counting the rest', async () => {
      const { api, bodies } = apiWith({ col_3: 'three', col_70: 'seventy', col_129: 'last' });
      renderSecurity(<RowDetail row={{ id: 'ev-1', event_time: '2026-11-01T12:00:00Z', col_0: 'x' }} columns={['col_0']} meta={many} onClose={() => {}} full={{ index: 'http_activity', window }} />, { api });
      fireEvent.click(screen.getByRole('button', { name: 'Show every field' }));
      await waitFor(() => expect(screen.getByTestId('full-row')).toBeInTheDocument());
      expect(bodies).toHaveLength(3);
      for (const b of bodies) {
        expect((b as unknown as { window: { start: string; end: string } }).window).toEqual({ start: '2026-11-01T11:59:00.000Z', end: '2026-11-01T12:01:00.000Z' });
        expect(b.columns.length).toBeLessThanOrEqual(60);
        expect(b.filters).toEqual([{ field: 'id', op: 'eq', value: 'ev-1' }]);
      }
      expect(bodies.flatMap((b) => b.columns)).toHaveLength(130);
      const full = screen.getByTestId('full-row');
      expect(full).toHaveTextContent('3 fields have a value; 127 are empty for this event.');
      for (const v of ['three', 'seventy', 'last']) expect(full).toHaveTextContent(v);
      fireEvent.click(screen.getByRole('button', { name: 'Show fewer fields' }));
      expect(screen.queryByTestId('full-row')).toBeNull();
    });

    it('says plainly when the event can no longer be read', async () => {
      const base = createFixtureApi(0);
      const api: SiemApi = { mode: 'fixtures', call: async (name, input) => (name === 'rows' ? ({ as_of: window.end, index_name: 'http_activity', columns: [], rows: [] } as never) : base.call(name, input)) };
      renderSecurity(<RowDetail row={{ id: 'gone', uri_path: '/a' }} columns={['uri_path']} meta={meta} onClose={() => {}} full={{ index: 'http_activity', window }} />, { api });
      fireEvent.click(screen.getByRole('button', { name: 'Show every field' }));
      expect(await screen.findByText(/no longer in the time range/)).toBeInTheDocument();
    });
  });
});

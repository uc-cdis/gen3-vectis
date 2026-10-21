import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSecurity } from '@/components/security/testing/render';
import { getMockUrl, setMockUrl } from '@/test/nextRouterMock';
import type { QuerySpec } from '../spec';
import { SHOW_DRS_EVIDENCE } from './drs';
import { SpecActionsMenu } from './SpecActionsMenu';

const spec = {
  index_name: 'http_activity', window: { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' },
  columns: ['src_ip'], filters: [], sort: null,
} as unknown as QuerySpec;

describe('SpecActionsMenu', () => {
  it('keeps the DRS evidence pointers off while they are not real DRS ids', () => {
    expect(SHOW_DRS_EVIDENCE).toBe(false);
  });

  it('offers the copy actions and Copy Python and open Workspaces, but no DRS manifest', async () => {
    renderSecurity(<SpecActionsMenu spec={spec} rows={[{ object_id: 'drs://host/abc', evidence_uri: 'drs://host/abc' }]} timeField="event_time" />);
    await userEvent.click(screen.getByRole('button', { name: 'Use this query elsewhere' }));
    // Read the whole list in one go: the dropdown animates in and out, so separate queries can see different states.
    const items = (await screen.findAllByRole('menuitem')).map((e) => e.textContent ?? '');
    expect(items.some((i) => i.startsWith('Copy as Python'))).toBe(true);
    expect(items).toContain('Copy Python and open Workspaces');
    expect(items.join(' | ')).not.toMatch(/manifest|drs/i);
  });

  describe('Copy Python and open Workspaces', () => {
    afterEach(() => { vi.unstubAllGlobals(); setMockUrl('/'); });
    const clickIt = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Use this query elsewhere' }));
      const items = await screen.findAllByRole('menuitem');
      await userEvent.click(items.find((e) => e.textContent === 'Copy Python and open Workspaces')!);
    };

    it('copies Python for this site, then opens Workspaces', async () => {
      const written: string[] = [];
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (s: string) => { written.push(s); } } });
      renderSecurity(<SpecActionsMenu spec={spec} rows={[]} timeField="event_time" />, { url: '/Security?tab=data' });
      await clickIt();
      await screen.findByText(/paste it into a notebook cell/);
      expect(written).toHaveLength(1);
      expect(written[0]).toContain(`ENDPOINT = "${window.location.origin}"`);
      expect(written[0]).toContain('/guppy/graphql');
      expect(written[0]).toContain('VECTIS_TOKEN');
      expect(getMockUrl()).toBe('/Workspaces');
    });

    it('stays on the page, and shows the code to copy by hand, when the clipboard is refused', async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('denied'); } } });
      document.execCommand = () => false;
      renderSecurity(<SpecActionsMenu spec={spec} rows={[]} timeField="event_time" />, { url: '/Security?tab=data' });
      await clickIt();
      expect(await screen.findByLabelText('Python text')).toBeInTheDocument();
      expect(getMockUrl()).toBe('/Security?tab=data');
    });
  });
});

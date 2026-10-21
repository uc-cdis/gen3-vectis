import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiWith, renderJobs } from './testUtils';
import WtsConnect from './WtsConnect';

const live = apiWith({ mode: 'live' } as never);
const answer = (status: number) => vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('WtsConnect', () => {
  it('shows nothing and does not redirect when the token service is connected', async () => {
    const fetchMock = answer(200); vi.stubGlobal('fetch', fetchMock);
    const redirect = vi.fn();
    renderJobs(<WtsConnect redirect={redirect} />, live);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/wts/oauth2/connected', expect.anything()));
    expect(screen.queryByTestId('wts-connect')).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });
  it('sends you to the approval screen once, and keeps a link', async () => {
    vi.stubGlobal('fetch', answer(403));
    const redirect = vi.fn();
    const first = renderJobs(<WtsConnect redirect={redirect} />, live);
    expect(await screen.findByTestId('wts-connect')).toBeInTheDocument();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/wts/oauth2/authorization_url?redirect=/Jobs');
    expect(screen.getByRole('link', { name: 'Approve now' })).toHaveAttribute('href', '/wts/oauth2/authorization_url?redirect=/Jobs');
    first.unmount();
    renderJobs(<WtsConnect redirect={redirect} />, live); // same browser session: no second redirect
    expect(await screen.findByTestId('wts-connect')).toBeInTheDocument();
    expect(redirect).toHaveBeenCalledTimes(1);
  });
  it.each([404, 500])('stays quiet when the service answers %i (not deployed or down)', async (status) => {
    const fetchMock = answer(status); vi.stubGlobal('fetch', fetchMock);
    const redirect = vi.fn();
    renderJobs(<WtsConnect redirect={redirect} />, live);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('wts-connect')).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });
  it('does nothing on the fixtures page', async () => {
    const fetchMock = answer(403); vi.stubGlobal('fetch', fetchMock);
    renderJobs(<WtsConnect redirect={vi.fn()} />, apiWith());
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

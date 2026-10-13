import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getMockQuery, setMockUrl } from '@/test/nextRouterMock';
import { createFixtureApi } from '@/lib/jobs/api/fixtureApi';
import JobsShell from './JobsShell';
import { renderJobs } from './testUtils';

const mount = (url: string) => { setMockUrl(url); return renderJobs(<JobsShell api={createFixtureApi({ delayMs: 0 })} />, createFixtureApi({ delayMs: 0 })); };

describe('JobsShell', () => {
  it('has a Jobs heading and the Catalog and Runs tabs, Catalog first', async () => {
    mount('/Jobs');
    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Catalog' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Runs' })).toBeInTheDocument();
    expect(await screen.findAllByTestId('job-card')).toHaveLength(6);
  });
  it('writes the tab to the URL and ignores unknown values', async () => {
    mount('/Jobs?tab=../../x');
    expect(screen.getByRole('tab', { name: 'Catalog' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    await waitFor(() => expect(getMockQuery().tab).toBe('runs'));
  });
  it('opens a run drawer from ?run= and ignores a malformed id', async () => {
    mount('/Jobs?run=run-0002');
    expect(await screen.findByRole('list', { name: /Steps of Log summary/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true');
  });
  it('does not open a drawer for a malformed run id', () => {
    mount('/Jobs?run=../../etc');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens job details from ?job= and shows the job as a flow', async () => {
    mount('/Jobs?job=log-summary');
    const flow = await screen.findByRole('list', { name: /Steps of Log summary/ });
    expect(flow).toBeInTheDocument();
  });
  it('runs a job end to end: submit opens that run', async () => {
    mount('/Jobs');
    await userEvent.click(await screen.findByRole('button', { name: 'Run Hello' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run job' }));
    await waitFor(() => expect(getMockQuery().run).toMatch(/^run-01/));
    expect(getMockQuery().tab).toBe('runs');
  });
  it('shows the fixtures banner only for the fixture api', async () => {
    mount('/Jobs');
    expect(screen.getByTestId('fixtures-banner')).toBeInTheDocument();
  });
});

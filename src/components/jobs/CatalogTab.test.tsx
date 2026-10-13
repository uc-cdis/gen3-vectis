import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobsApiError } from '@/lib/jobs/api';
import { createFixtureApi } from '@/lib/jobs/api/fixtureApi';
import CatalogTab from './CatalogTab';
import { apiWith, renderJobs } from './testUtils';

describe('CatalogTab', () => {
  it('shows each job with tags, image, resources, secret NAMES, owner and the catalog version', async () => {
    renderJobs(<CatalogTab onRun={() => undefined} onDetails={() => undefined} />);
    const cards = await screen.findAllByTestId('job-card');
    expect(cards).toHaveLength(6); // 3 container jobs + 3 workflow jobs
    const exp = screen.getByRole('article', { name: 'Export report' });
    expect(within(exp).getByText('reporting-api-token')).toBeInTheDocument();
    expect(within(exp).getByText(/Secret values are never shown/)).toBeInTheDocument();
    expect(within(exp).getByText('security-engineering')).toBeInTheDocument();
    expect(within(exp).getByText('python:3.9-slim')).toBeInTheDocument();
    expect(within(exp).getByText(/1 CPU · 2 GB RAM/)).toBeInTheDocument();
    const hello = screen.getByRole('article', { name: 'Hello' });
    expect(within(hello).getByText('example')).toBeInTheDocument();
    expect(within(hello).getByText(/Secrets needed:/).parentElement!.textContent).toContain('none');
    const src = screen.getByTestId('catalog-source');
    expect(src).toHaveTextContent('example-org/vectis-jobs@main');
    expect(src).toHaveTextContent('3f9c2a1'); // short sha only
    expect(src).not.toHaveTextContent('3f9c2a1b7d');
  });
  it('shows the kind of each job: Container, or Workflow with its engine', async () => {
    renderJobs(<CatalogTab onRun={() => undefined} onDetails={() => undefined} />);
    await screen.findAllByTestId('job-card');
    const badges = screen.getAllByTestId('kind-badge').map((b) => b.textContent);
    expect(badges.filter((b) => b === 'Container')).toHaveLength(3);
    expect(badges.filter((b) => b === 'Workflow · dagu')).toHaveLength(3);
    const fan = screen.getByRole('article', { name: 'Fan-out and join' });
    expect(within(fan).getByText('Steps:').parentElement!.textContent).toContain('4');
    expect(within(fan).queryByText(/Image:/)).toBeNull();
    expect(within(fan).queryByText(/Secrets needed/)).toBeNull();
  });
  it('opens run and details for the right job', async () => {
    const onRun = vi.fn(); const onDetails = vi.fn();
    renderJobs(<CatalogTab onRun={onRun} onDetails={onDetails} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Run Hello' }));
    await userEvent.click(screen.getByRole('button', { name: 'Details of Log summary' }));
    expect(onRun).toHaveBeenCalledWith('hello');
    expect(onDetails).toHaveBeenCalledWith('log-summary');
  });
  it('lists definitions that failed validation in a collapsed section', async () => {
    renderJobs(<CatalogTab onRun={() => undefined} onDetails={() => undefined} />);
    const btn = await screen.findByRole('button', { name: '1 definition could not be loaded' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);
    expect(screen.getByText('broken-job.yaml')).toBeInTheDocument();
    expect(screen.getByText('/image must be string')).toBeInTheDocument();
  });
  it('explains a catalog that is not configured, naming the settings', async () => {
    renderJobs(<CatalogTab onRun={() => undefined} onDetails={() => undefined} />, createFixtureApi({ delayMs: 0, catalog: 'none' }));
    const box = await screen.findByTestId('catalog-unconfigured');
    expect(box).toHaveTextContent('not configured');
    expect(box).toHaveTextContent('TES_CATALOG_REPO');
    expect(screen.queryByTestId('job-card')).toBeNull();
  });
  it('says so when the catalog has no definitions', async () => {
    renderJobs(<CatalogTab onRun={() => undefined} onDetails={() => undefined} />, createFixtureApi({ delayMs: 0, catalog: 'empty' }));
    expect(await screen.findByText(/No job definitions/)).toBeInTheDocument();
  });
  it('shows an error with retry', async () => {
    renderJobs(<CatalogTab onRun={() => undefined} onDetails={() => undefined} />, apiWith({ catalog: async () => { throw new JobsApiError(502, 'x'); } }));
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

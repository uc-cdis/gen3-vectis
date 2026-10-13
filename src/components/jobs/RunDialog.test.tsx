import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseJobDef } from '@/lib/jobs/jobdef/parse';
import type { JobDef } from '@/lib/jobs/jobdef/types';
import { JobsApiError } from '@/lib/jobs/api';
import { EXAMPLE_YAML } from '@/lib/jobs/api/fixtureApi';
import RunDialog, { paramError, paramsToSend, previewSpec, submitMessage } from './RunDialog';
import { apiWith, renderJobs } from './testUtils';

const def = (f: string): JobDef => { const r = parseJobDef(EXAMPLE_YAML[f]); if (!r.ok) throw new Error(r.errors.join()); return r.def; };
const REPO = 'example-org/vectis-jobs';
const SHA = '3f9c2a1b7d4e5f60a8b9c0d1e2f3a4b5c6d7e8f9';
const mount = (job: JobDef, api = apiWith(), onSubmitted = vi.fn()) => {
  renderJobs(<RunDialog job={job} repo={REPO} sha={SHA} onClose={() => undefined} onSubmitted={onSubmitted} />, api);
  return onSubmitted;
};
const runBtn = () => screen.getByRole('button', { name: 'Run job' });
const fillValid = async () => {
  await userEvent.type(screen.getByLabelText(/Log file/), 's3://my-bucket/logs/a.log');
  await userEvent.type(screen.getByLabelText(/Result location/), 's3://my-bucket/out/result.json');
};

describe('parameter form', () => {
  it('generates a field per param type with labels and help text', () => {
    mount(def('log-summary.yaml'));
    expect(screen.getByLabelText(/Log file/)).toBeRequired();
    expect(screen.getByText('s3:// URL of the log file to summarise')).toBeInTheDocument();
    expect(screen.getByLabelText(/Top N/)).toHaveValue('10');
    expect(screen.getByLabelText(/Field name/)).toHaveValue('status');
  });
  it('renders enum as a select and boolean as a switch (export-report)', async () => {
    mount(def('export-report.yaml'));
    expect(screen.getAllByLabelText(/^Report/)[0]).toBeInTheDocument(); // Mantine Select input
    expect(screen.getByRole('switch', { name: /Include blocked requests/ })).toBeChecked();
    expect(screen.getByLabelText(/Reference list/)).toHaveAttribute('placeholder', 'https://example.org/file');
    expect(await screen.findByText('Your storage bucket:')).toBeInTheDocument();
  });
  it('validates every param type like the server does', () => {
    const p = (o: object) => ({ name: 'x', label: 'X', ...o }) as never;
    expect(paramError(p({ type: 'integer', min: 1, max: 5 }), '9')).toBe('Must be at most 5.');
    expect(paramError(p({ type: 'integer' }), '1.5')).toMatch(/integer/);
    expect(paramError(p({ type: 'number' }), '1.5')).toBeNull();
    expect(paramError(p({ type: 'string', pattern: '^[a-z]+$' }), 'ABC')).toMatch(/format/);
    expect(paramError(p({ type: 'enum', values: ['a'] }), 'b')).toMatch(/allowed/);
    expect(paramError(p({ type: 's3_url' }), 'https://x')).toMatch(/s3/);
    expect(paramError(p({ type: 'http_url' }), 'http://x.org')).toMatch(/https/);
    expect(paramError(p({ type: 'string', required: true }), '')).toBe('This field is required.');
    expect(paramError(p({ type: 'string' }), '')).toBeNull();
    expect(paramsToSend([p({ name: 'n', type: 'integer' }), p({ name: 'b', type: 'boolean' })], { n: '7', b: true })).toEqual({ n: 7, b: true });
  });
  it('shows inline errors and keeps submit disabled while invalid', async () => {
    mount(def('log-summary.yaml'));
    expect(runBtn()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Log file/), 'not a url');
    expect(await screen.findByText('Must be an s3://bucket/key URL.')).toBeInTheDocument();
    expect(runBtn()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Result location/), 's3://b/o.json');
    expect(runBtn()).toBeDisabled(); // first field still bad
  });
});

describe('preview', () => {
  it('hides env values and lists secret references by name only', async () => {
    mount(def('export-report.yaml'));
    await userEvent.click(screen.getAllByLabelText(/^Report/)[0]);
    await userEvent.click(await screen.findByText('top-talkers'));
    expect(await screen.findByText(/secret reference \(value never shown\)/)).toBeInTheDocument();
    const json = screen.getByLabelText('What will be sent').textContent!;
    expect(json).not.toContain('secret://');
    expect(json).toContain('[secret reference]');
    expect(json).toContain('s3://vectis-user-fixture/reports/top-talkers.csv');
    expect(screen.getByTestId('warnings')).toHaveTextContent(/passed through unresolved/);
  });
  it('replaces literal env values', () => {
    const p = previewSpec({ steps: [{ env: { A: 'plain-value', B: 'secret://tok' } }] });
    expect(p.json).not.toContain('plain-value');
    expect(p.secrets).toEqual(['B']);
  });
  it('explains an unavailable storage bucket and blocks submit', async () => {
    mount(def('export-report.yaml'), apiWith({ storageSetup: async () => { throw new JobsApiError(503, 'x'); } }));
    await userEvent.click(screen.getAllByLabelText(/^Report/)[0]);
    await userEvent.click(await screen.findByText('top-talkers'));
    expect(await screen.findByText('Your storage bucket is unavailable')).toBeInTheDocument();
    expect(runBtn()).toBeDisabled();
  });
});

describe('submit', () => {
  it('submits typed params once and reports the new run id', async () => {
    const submitJob = vi.fn(async () => ({ id: 'run-0200', warnings: [] }));
    const onSubmitted = mount(def('log-summary.yaml'), apiWith({ submitJob }));
    await fillValid();
    await waitFor(() => expect(runBtn()).toBeEnabled());
    await userEvent.click(runBtn());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ id: 'run-0200', warnings: [] }));
    expect(submitJob).toHaveBeenCalledWith({ job: 'log-summary', params: { input_url: 's3://my-bucket/logs/a.log', output_url: 's3://my-bucket/out/result.json', top_n: 10, field: 'status' } });
  });
  it('is disabled while pending, so a double click submits once', async () => {
    let release: (v: { id: string; warnings: string[] }) => void = () => undefined;
    const submitJob = vi.fn(() => new Promise<{ id: string; warnings: string[] }>((r) => { release = r; }));
    mount(def('log-summary.yaml'), apiWith({ submitJob }));
    await fillValid();
    await waitFor(() => expect(runBtn()).toBeEnabled());
    await userEvent.dblClick(runBtn());
    expect(submitJob).toHaveBeenCalledTimes(1);
    expect(runBtn()).toBeDisabled();
    release({ id: 'run-1', warnings: [] });
  });
  it.each([
    [403, 'You can view jobs but are not allowed to run them.'],
    [400, 'The parameters were refused. top_n: must be at most 100'],
    [500, 'The job could not be submitted because of a problem on the server. Try again in a moment.'],
    [0, 'The job could not be submitted because of a problem on the server. Try again in a moment.'],
  ])('shows the right message for status %i', async (status, text) => {
    const submitJob = vi.fn(async () => { throw new JobsApiError(status, status === 500 ? 'secret internals' : 'The parameters were refused.', status === 400 ? ['top_n: must be at most 100'] : []); });
    mount(def('log-summary.yaml'), apiWith({ submitJob }));
    await fillValid();
    await waitFor(() => expect(runBtn()).toBeEnabled());
    await userEvent.click(runBtn());
    expect(await screen.findByTestId('submit-error')).toHaveTextContent(text);
    expect(screen.getByTestId('submit-error')).not.toHaveTextContent('internals');
    expect(runBtn()).toBeEnabled(); // can retry
  });
  it('shows server text as plain text', () => {
    expect(submitMessage(new JobsApiError(422, '<b>bad</b>‮'))).toBe('<b>bad</b>');
  });
});

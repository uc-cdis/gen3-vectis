import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAG_FIXTURE_DEFS } from '@/lib/jobs/api/fixtureApi';
import type { JobParam } from '@/lib/jobs/jobdef/types';
import RunDialog, { paramError } from './RunDialog';
import { apiWith, renderJobs } from './testUtils';

const fan = DAG_FIXTURE_DEFS.find((d) => d.id === 'dag-fanout')!;
const soc = DAG_FIXTURE_DEFS.find((d) => d.id === 'dag-soc-enrich')!;

describe('RunDialog for a workflow job', () => {
  it('holds string params to the shell-safe charset (a permissive pattern does not help), and says what will be sent', async () => {
    const submitJob = vi.fn(async () => ({ id: 'fanout.fx9', warnings: [] }));
    const onSubmitted = vi.fn();
    renderJobs(<RunDialog job={fan} repo="o/r" sha={'a'.repeat(40)} onClose={() => undefined} onSubmitted={onSubmitted} />, apiWith({ submitJob }));
    const field = screen.getByLabelText(/Label/);
    const run = screen.getByRole('button', { name: 'Run job' });
    await userEvent.clear(field);
    await userEvent.type(field, 'a;b');
    expect(await screen.findByText(/does not match the required format/i)).toBeInTheDocument();
    expect(run).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, 'release_7');
    expect(run).toBeEnabled();
    expect(screen.getByTestId('preview')).toHaveTextContent('Workflow · dagu');
    expect(screen.getByTestId('preview')).toHaveTextContent('{"label":"release_7"}');
    await userEvent.click(run);
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(submitJob).toHaveBeenCalledWith({ job: 'dag-fanout', params: { label: 'release_7' } });
  });
  it('paramError applies the stricter workflow check only when asked', () => {
    const p: JobParam = { name: soc.params![0].name, label: 'Indicator', type: 'string' };
    expect(paramError(p, 'a b', false)).toBeNull();
    expect(paramError(p, 'a b', true)).toMatch(/letters, digits/);
    expect(paramError(p, '$(id)', true)).not.toBeNull();
    expect(paramError(p, '203.0.113.9', true)).toBeNull();
  });
});

import React from 'react';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { JobsApi } from '@/lib/jobs/api';
import { JobsApiProvider } from '@/lib/jobs/api/hooks';
import { createFixtureApi } from '@/lib/jobs/api/fixtureApi';
import type { Run } from '@/lib/jobs/model';
import { fromTesTask } from '@/lib/jobs/tes/adapter';
import { normalizeTask } from '@/lib/jobs/tes/normalize';

/** A fixture API with some methods replaced. */
export const apiWith = (over: Partial<JobsApi> = {}): JobsApi => ({ ...createFixtureApi({ delayMs: 0 }), ...over });

export const renderJobs = (ui: React.ReactElement, api: JobsApi = apiWith()) =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MantineProvider><JobsApiProvider api={api}>{ui}</JobsApiProvider></MantineProvider>
    </SWRConfig>,
  );

/** A Run for component tests, built from a TES-shaped wire task through the same normalizeTask -> fromTesTask path the server uses. */
export function task(over: Record<string, unknown> = {}, logs: unknown[] = []): Run {
  return fromTesTask(normalizeTask({
    id: 't-1', state: 'COMPLETE', name: 'Test run', creation_time: '2026-10-01T10:00:00Z',
    executors: [{ image: 'alpine:3.20', command: ['echo', 'hi'] }],
    inputs: [{ path: '/in', url: 's3://b/in' }], outputs: [{ path: '/out', url: 's3://b/out' }],
    tags: { 'vectis.job': 'hello', 'vectis.submitted_by': 'me' }, logs, ...over,
  })!);
}
export const execLog = (over: Record<string, unknown> = {}) => ({ start_time: '2026-10-01T10:00:01Z', end_time: '2026-10-01T10:00:05Z', stdout: '', stderr: '', exit_code: 0, ...over });

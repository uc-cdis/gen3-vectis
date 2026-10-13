import React, { useCallback, useState } from 'react';
import { Group, Tabs, Text, Title } from '@mantine/core';
import { PanelErrorBoundary, WarningCard } from '@gen3/frontend';
import { useRouter } from 'next/router';
import { isRunId } from '@/lib/jobs/model';
import type { JobsApi } from '@/lib/jobs/api';
import { JobsApiProvider, useJobsApi } from '@/lib/jobs/api/hooks';
import CatalogTab, { JobDetailsDrawer, useCatalog } from './CatalogTab';
import RunDialog from './RunDialog';
import RunDrawer from './RunDrawer';
import type { PollPhase } from './model';
import RunsTab from './RunsTab';

const TABS = [{ id: 'catalog', label: 'Catalog' }, { id: 'runs', label: 'Runs' }] as const;
type TabId = (typeof TABS)[number]['id'];
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ModeBanner = () => {
  if (useJobsApi().mode !== 'fixtures') return null;
  return (
    <div data-testid="fixtures-banner">
      <WarningCard message="Development fixtures: this page is showing synthetic sample data, not your data. It is available only in development builds." />
    </div>
  );
};

const Inner = ({ runsSchedule, drawerSchedule }: { runsSchedule?: readonly PollPhase[]; drawerSchedule?: readonly PollPhase[] }) => {
  const router = useRouter();
  const q = router.query;
  const runId = (() => { const r = first(q.run); return isRunId(r) ? r : null; })();
  const jobId = first(q.job) ?? null;
  const asked = first(q.tab);
  const tab: TabId = asked === 'runs' || runId ? 'runs' : 'catalog';
  const [running, setRunning] = useState<string | null>(null); // job whose run dialog is open
  const catalog = useCatalog();

  const push = useCallback((patch: Record<string, string | undefined>) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...router.query, ...patch })) { const s = first(v as string | string[] | undefined); if (s) next[k] = s; }
    void router.push({ pathname: router.pathname, query: next }, undefined, { shallow: true });
  }, [router]);

  const jobs = catalog.data?.jobs ?? [];
  const details = jobId ? jobs.find((j) => j.def.id === jobId)?.def : undefined;
  const toRun = running ? jobs.find((j) => j.def.id === running)?.def : undefined;

  return (
    <div className="w-full px-6 py-4" data-testid="jobs-shell">
      <Group align="baseline" gap="sm" mb="xs"><Title order={2}>Jobs</Title></Group>
      <ModeBanner />
      <Tabs value={tab} onChange={(v) => v && push({ tab: v, run: undefined, job: undefined })} keepMounted={false}>
        <Tabs.List mb="md" aria-label="Jobs sections">{TABS.map((t) => <Tabs.Tab key={t.id} value={t.id}>{t.label}</Tabs.Tab>)}</Tabs.List>
        <Tabs.Panel value={tab}>
          <PanelErrorBoundary>
            {tab === 'catalog'
              ? <CatalogTab onRun={setRunning} onDetails={(id) => push({ job: id })} />
              : <RunsTab onOpen={(id) => push({ run: id })} schedule={runsSchedule} />}
          </PanelErrorBoundary>
        </Tabs.Panel>
      </Tabs>
      {details ? <JobDetailsDrawer def={details} onClose={() => push({ job: undefined })} onRun={() => { push({ job: undefined }); setRunning(details.id); }} /> : null}
      {toRun && catalog.data?.repo && catalog.data.sha ? (
        <RunDialog
          job={toRun} repo={catalog.data.repo} sha={catalog.data.sha}
          onClose={() => setRunning(null)}
          onSubmitted={(r) => { setRunning(null); push({ tab: 'runs', run: r.id, job: undefined }); }}
        />
      ) : null}
      {runId ? <RunDrawer id={runId} onClose={() => push({ run: undefined })} schedule={drawerSchedule} /> : null}
      <Text size="xs" c="dimmed" mt="lg">Times are shown in your local time zone.</Text>
    </div>
  );
};

/** `api` is injectable for tests and the development page; production always uses the live API. */
const JobsShell = ({ api, runsSchedule, drawerSchedule }: { api?: JobsApi; runsSchedule?: readonly PollPhase[]; drawerSchedule?: readonly PollPhase[] }) => (
  <JobsApiProvider api={api}><Inner runsSchedule={runsSchedule} drawerSchedule={drawerSchedule} /></JobsApiProvider>
);
export default JobsShell;

import React from 'react';
import type { NavPageLayoutProps } from '@gen3/frontend';
import { NavPageLayout, getNavPageLayoutPropsFromConfig } from '@gen3/frontend';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import JobsShell from '@/components/jobs/JobsShell';
import type { JobsApi } from '@/lib/jobs/api';
import type { createFixtureApi } from '@/lib/jobs/api/fixtureApi';

const FAST = [{ untilMs: 600_000, everyMs: 400 }]; // so a test does not wait seconds

// DEVELOPMENT ONLY. Renders Jobs against synthetic fixtures, with no login, so it can be exercised in a real browser
// (see e2e/). In a production build getServerSideProps returns 404, and nothing links here.
const DevJobs = ({ headerProps, footerProps }: NavPageLayoutProps) => {
  const router = useRouter();
  const catalogMode = router.query.catalog === 'none' ? 'none' : router.query.catalog === 'empty' ? 'empty' : 'full';
  const fast = router.query.fast === '1'; // fast polling so a test does not wait seconds
  // Guarded require: a production build drops this branch and the fixture module with it.
  // A ternary (not an early return) so webpack sees the constant condition and never bundles the dead branch.
  const api = React.useMemo<JobsApi | undefined>(
    () => (process.env.NODE_ENV === 'production'
      ? undefined
      : (require('@/lib/jobs/api/fixtureApi') as { createFixtureApi: typeof createFixtureApi }).createFixtureApi({ delayMs: 40, catalog: catalogMode })),
    [catalogMode],
  );
  return (
    <NavPageLayout {...{ headerProps, footerProps }} headerMetadata={{ title: 'Vectis Jobs (dev)', content: 'Development fixtures', key: 'vectis-jobs-dev' }}>
      <JobsShell api={api} runsSchedule={fast ? FAST : undefined} drawerSchedule={fast ? FAST : undefined} />
    </NavPageLayout>
  );
};

export const getServerSideProps: GetServerSideProps<NavPageLayoutProps> = async () => {
  if (process.env.NODE_ENV === 'production') return { notFound: true };
  return { props: { ...(await getNavPageLayoutPropsFromConfig()) } };
};

export default DevJobs;

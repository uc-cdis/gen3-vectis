import React from 'react';
import type { NavPageLayoutProps } from '@gen3/frontend';
import { NavPageLayout, getNavPageLayoutPropsFromConfig } from '@gen3/frontend';
import type { GetServerSideProps } from 'next';
import JobsShell from '@/components/jobs/JobsShell';

// Jobs: a catalog of approved jobs and the runs of the signed-in user, over GA4GH TES.
const Page = ({ headerProps, footerProps }: NavPageLayoutProps) => (
  <NavPageLayout
    {...{ headerProps, footerProps }}
    headerMetadata={{ title: 'Vectis Jobs', content: 'Vectis jobs: run approved jobs and follow their progress', key: 'vectis-jobs' }}
  >
    <JobsShell />
  </NavPageLayout>
);

export const getServerSideProps: GetServerSideProps<NavPageLayoutProps> = async () => ({
  props: { ...(await getNavPageLayoutPropsFromConfig()) },
});

export default Page;

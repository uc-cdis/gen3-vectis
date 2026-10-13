import React from 'react';
import type { NavPageLayoutProps } from '@gen3/frontend';
import { NavPageLayout, getNavPageLayoutPropsFromConfig } from '@gen3/frontend';
import type { GetServerSideProps } from 'next';
import { SECTIONS } from './context';
import type { SectionPath } from './context';
import SecurityShell from './SecurityShell';

/**
 * The five console pages (src/pages/Security.tsx, Alerts.tsx, Cases.tsx, Investigate.tsx, Detection.tsx) are one
 * implementation: each page file is `export default securityPage('/Path')` plus the shared getServerSideProps.
 * Adding a page means adding it to SECTIONS, config/gen3/authz.json and navigation.json, and one such file.
 */
export const securityPage = (section: SectionPath) => {
  const { title } = SECTIONS[section];
  const Page = ({ headerProps, footerProps }: NavPageLayoutProps) => (
    <NavPageLayout
      {...{ headerProps, footerProps }}
      headerMetadata={{ title: `Vectis ${title}`, content: `Vectis security console: ${title}`, key: `vectis-security-${title.toLowerCase()}` }}
    >
      <SecurityShell section={section} />
    </NavPageLayout>
  );
  return Page;
};

export const getSecurityServerSideProps: GetServerSideProps<NavPageLayoutProps> = async () => ({
  props: { ...(await getNavPageLayoutPropsFromConfig()) },
});

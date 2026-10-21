import React from 'react';
import type { NavPageLayoutProps } from '@gen3/frontend';
import { NavPageLayout, getNavPageLayoutPropsFromConfig } from '@gen3/frontend';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { SECTIONS, isTabId, pathOfTab } from '@/components/security/context';
import type { SectionPath } from '@/components/security/context';
import SecurityShell from '@/components/security/SecurityShell';
import type { SiemApi } from '@/lib/vectis-kit/api/client';
import type { createFixtureApi } from '@/lib/vectis-kit/api/fixtureApi';

// DEVELOPMENT ONLY. Renders the console against synthetic fixtures, with no login, so each tab can be exercised in a
// real browser (see e2e/). In a production build getServerSideProps returns 404, and nothing links here.
const DevSecurity = ({ headerProps, footerProps }: NavPageLayoutProps) => {
  // The dev page always renders a real section page, exactly as it ships. ?section=/Investigate names one; the older
  // ?tab=hunt form is mapped to the page that tab lives on, so no screenshot ever shows every tab under the top nav.
  const query = useRouter().query;
  const asked = query.section;
  const tab = typeof query.tab === 'string' && isTabId(query.tab) ? query.tab : null;
  const section: SectionPath = typeof asked === 'string' && asked in SECTIONS ? (asked as SectionPath) : tab ? pathOfTab(tab) : '/Security';
  // The fixtures are loaded with a guarded require so a production build drops this branch, and the fixture module
  // with it. A static import here would put the fixture data into the production bundle.
  // ?scenario=healthy serves fixtures with nothing quarantined.
  const healthy = query.scenario === 'healthy';
  // ?api=local reads a local siem-app service started with scripts/dev_real_data.py.
  const local = query.api === 'local';
  const api = React.useMemo<SiemApi | undefined>(
    () => {
      if (process.env.NODE_ENV === 'production') return undefined;
      if (local) {
        const { createLiveApi } = require('@/lib/vectis-kit/api/client') as { createLiveApi: typeof import('@/lib/vectis-kit/api/client').createLiveApi };
        return createLiveApi((input, init) => fetch(String(input).replace('/api/siem/', 'http://127.0.0.1:8011/siem/'), { ...init, credentials: 'omit' }));
      }
      return (require('@/lib/vectis-kit/api/fixtureApi') as { createFixtureApi: typeof createFixtureApi }).createFixtureApi(60, healthy ? { scenario: 'healthy' } : {});
    },
    [healthy, local],
  );
  return (
    <NavPageLayout {...{ headerProps, footerProps }} headerMetadata={{ title: 'Vectis Security (dev)', content: 'Development fixtures', key: 'vectis-security-dev' }}>
      <SecurityShell api={api} section={section} />
    </NavPageLayout>
  );
};

export const getServerSideProps: GetServerSideProps<NavPageLayoutProps> = async () => {
  if (process.env.NODE_ENV === 'production') return { notFound: true };
  return { props: { ...(await getNavPageLayoutPropsFromConfig()) } };
};

export default DevSecurity;

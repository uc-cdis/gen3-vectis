import React from 'react';
import type { NavPageLayoutProps } from '@gen3/frontend';
import { NavPageLayout, getNavPageLayoutPropsFromConfig } from '@gen3/frontend';
import type { GetServerSideProps } from 'next';
import { CompactDictionary } from '@/components/dictionary/CompactDictionary';
import { RAIL_WIDTH, WorkspaceDictionary } from '@/components/dictionary/WorkspaceDictionary';
import { parseDictionary } from '@/lib/dictionary/ddv2';
import type { DictionaryLoader } from '@/lib/dictionary/load';
import { LoadError } from '@/lib/dictionary/load';

// DEVELOPMENT ONLY. The workspace's dictionary against a small synthetic DDv2 dictionary, with no login: the compact panel
// at the rail's width, and the drawer button the workspace page offers in place of the framework's rail. In production
// getServerSideProps returns 404 and the fixture is dropped with the dead branch.
const fixture = (): unknown => (process.env.NODE_ENV === 'production' ? undefined : require('@/lib/dictionary/sample').SAMPLE_DICTIONARY);
const loader: DictionaryLoader = async () => { const r = parseDictionary(fixture()); if (!r.ok) throw new LoadError(r.error); return r.dictionary; };

const DevWorkspaceDictionary = ({ headerProps, footerProps }: NavPageLayoutProps) => (
  <NavPageLayout {...{ headerProps, footerProps }} headerMetadata={{ title: 'Workspace dictionary (dev)', content: 'Development fixtures', key: 'vectis-ws-dictionary-dev' }}>
    <div className="p-4">
      <p className="mb-2 text-sm">The compact panel at the rail width ({RAIL_WIDTH}px), and below it the workspace page's drawer button at the left edge.</p>
      <div style={{ width: RAIL_WIDTH, height: 700 }} className="border border-base-light" data-testid="rail-frame"><CompactDictionary loader={loader} /></div>
    </div>
    <WorkspaceDictionary loader={loader} />
  </NavPageLayout>
);

export const getServerSideProps: GetServerSideProps<NavPageLayoutProps> = async () => {
  if (process.env.NODE_ENV === 'production') return { notFound: true };
  return { props: { ...(await getNavPageLayoutPropsFromConfig()) } };
};

export default DevWorkspaceDictionary;

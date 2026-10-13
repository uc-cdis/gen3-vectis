import React from 'react';
import {
  DictionaryPageGetServerSideProps as getServerSideProps,
  NavPageLayout,
  PanelErrorBoundary,
  type DictionaryConfig,
  type NavPageLayoutProps,
} from '@gen3/frontend';
import { DictionaryScreen } from '@/components/dictionary/DictionaryScreen';

// The dictionary is the DDv2 document the commons serves at <submission API>/_dictionary/_all/ (an nginx rule in front of
// the published config/dd/current.json). The page reads and renders that model itself; it does not use the framework's
// dictionary viewer, which only understands the classic node-keyed shape. getServerSideProps is the framework's, and
// only supplies the navigation and the page's header metadata.
const DataDictionary = ({ headerProps, footerProps, config }: NavPageLayoutProps & { config: DictionaryConfig }) => (
  <NavPageLayout
    {...{ headerProps, footerProps }}
    mainProps={{ fixed: true }}
    headerMetadata={{
      title: 'Vectis Dictionary',
      content: 'Data Dictionary',
      key: 'vectis-dictionary-page',
      ...config?.headerMetadata,
    }}
  >
    <PanelErrorBoundary>
      <DictionaryScreen />
    </PanelErrorBoundary>
  </NavPageLayout>
);

export default DataDictionary;

export { getServerSideProps };

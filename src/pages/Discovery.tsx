import React from 'react';
import {
  DiscoveryPage,
  DiscoveryPageGetServerSideProps as getServerSideProps,
  PanelErrorBoundary,
} from '@gen3/frontend';

// Discovery loads via MDSAllLocal, which requests every record up front. If that
// request fails or times out the page can throw during render and kill the whole
// route. Same containment as Explorer — see src/pages/Explorer.tsx.
const Discovery = (props: React.ComponentProps<typeof DiscoveryPage>) => (
  <PanelErrorBoundary>
    <DiscoveryPage {...props} />
  </PanelErrorBoundary>
);

export default Discovery;

export { getServerSideProps };

import React from 'react';
import {
  ExplorerPage,
  ExplorerPageGetServerSideProps as getServerSideProps,
  PanelErrorBoundary,
} from '@gen3/frontend';

// The graph-backed indexes can time out or return an error payload instead of
// data. ExplorerPage then reads `_totalCount` off an undefined response inside a
// useMemo and throws during render, which propagates to the app-level boundary
// and takes down the entire route ("a client-side exception has occurred") —
// navigation included. Containing it here keeps a backend failure local: the
// page reports the error and the rest of the site stays usable.
const Explorer = (props: React.ComponentProps<typeof ExplorerPage>) => (
  <PanelErrorBoundary>
    <ExplorerPage {...props} />
  </PanelErrorBoundary>
);

export default Explorer;

export { getServerSideProps };

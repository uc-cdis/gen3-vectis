import React from 'react';
import {
  QueryPage,
  QueryPageGetServerSideProps as getServerSideProps,
  PanelErrorBoundary,
} from '@gen3/frontend';

// GraphiQL runs an introspection query on mount; a 404/504 from the graphql
// endpoint must surface as an error on this page rather than killing the route.
// Same containment as Explorer — see src/pages/Explorer.tsx.
const Query = (props: React.ComponentProps<typeof QueryPage>) => (
  <PanelErrorBoundary>
    <QueryPage {...props} />
  </PanelErrorBoundary>
);

export default Query;

export { getServerSideProps };

import React from 'react';
import type { ComponentProps } from 'react';
import type { GetServerSideProps } from 'next';
import {
  WorkspacesCenterPage,
  WorkspacesCenterPageGetServerSideProps,
} from '@gen3/workspaces';
import { WorkspaceDictionary } from '@/components/dictionary/WorkspaceDictionary';
import { withoutFrameworkDictionary } from '@/lib/dictionary/workspaceConfig';

type Props = ComponentProps<typeof WorkspacesCenterPage>;

// The framework's "Data & Tools" rail renders a dictionary panel that parses the classic node-keyed dictionary and cannot
// be replaced, so it is switched off for every tier (also in config/gen3/workspaces.json) and the native dictionary is
// offered as a drawer instead. Forcing it here means a missing or edited config file cannot bring the broken panel back.
const Workspaces = (props: Props) => (
  <>
    <WorkspacesCenterPage {...props} />
    <WorkspaceDictionary />
  </>
);

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const result = await WorkspacesCenterPageGetServerSideProps(ctx);
  if (!('props' in result)) return result;
  const props = await result.props;
  return { props: { ...props, configuration: withoutFrameworkDictionary(props.configuration) } };
};

export default Workspaces;

import type { GetServerSideProps, NextPage } from 'next';

const WorkspaceRedirectPage: NextPage = () => null;

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/workspaces/jupyter',
      permanent: false,
    },
  };
};

export default WorkspaceRedirectPage;

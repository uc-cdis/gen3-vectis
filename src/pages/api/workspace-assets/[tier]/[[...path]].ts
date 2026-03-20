// All workspace-asset serving logic lives in @gen3/jupyter-workspaces.
// Re-export the pre-configured handler so the consumer needs zero config.
import { createWorkspaceAssetsHandler } from '@gen3/jupyter-workspaces/server';

export default createWorkspaceAssetsHandler();

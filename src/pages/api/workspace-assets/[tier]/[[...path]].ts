import type { NextApiRequest, NextApiResponse } from 'next';
import { createWorkspaceAssetsHandler } from '@gen3/jupyter-workspaces/server';

const upstreamHandler = createWorkspaceAssetsHandler();
const VECTIS_WORKSPACE_APP_NAME = 'Vectis Workspaces';
const VECTIS_FAVICON_URL = '/icons/vectis-logo-mono-black.svg';

function injectVectisBranding(html: string) {
  const withConfig = html.replace(
    /(<script\s+id="jupyter-config-data"[^>]*>)\s*(\{[^]*?\})\s*(<\/script>)/,
    (_match, openTag: string, existingJson: string, closeTag: string) => {
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(existingJson) as Record<string, unknown>;
      } catch {
        existing = {};
      }

      const merged = {
        ...existing,
        appName: VECTIS_WORKSPACE_APP_NAME,
        faviconUrl: VECTIS_FAVICON_URL,
      };

      return `${openTag}${JSON.stringify(merged)}${closeTag}`;
    },
  );

  return withConfig.replace(
    /<title>[^<]*<\/title>/,
    `<title>${VECTIS_WORKSPACE_APP_NAME}</title>`,
  );
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const originalSend = res.send.bind(res);

  res.send = ((body: unknown) => {
    if (
      typeof body === 'string' &&
      body.includes('id="jupyter-config-data"') &&
      body.includes('<title>')
    ) {
      return originalSend(injectVectisBranding(body));
    }

    return originalSend(body);
  }) as typeof res.send;

  return upstreamHandler(req, res);
}

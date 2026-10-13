/**
 * One-time Perspective setup. Imported ONLY by PerspectiveGridInner, which is itself loaded client-side only, so no
 * WebAssembly is touched during server rendering or on import of anything else.
 *
 * The two .wasm files are served as static assets (the bundler rule in next.config.js turns the import into a URL);
 * nothing is fetched until the first grid mounts, and the setup runs once per page load.
 */
import perspective from '@perspective-dev/client';
import perspective_viewer from '@perspective-dev/viewer';
import '@perspective-dev/viewer-datagrid';
import '@perspective-dev/viewer-charts';
import '@perspective-dev/viewer/dist/css/themes.css';
import SERVER_WASM from '@perspective-dev/server/dist/wasm/perspective-server.wasm';
import CLIENT_WASM from '@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm';

type Client = Awaited<ReturnType<typeof perspective.worker>>;
let ready: Promise<Client> | null = null;

/** Resolves with the shared worker client. A failure is not cached, so the user can retry. */
export function getPerspectiveClient(): Promise<Client> {
  if (!ready) {
    ready = (async () => {
      perspective.init_server(fetch(SERVER_WASM));
      await perspective_viewer.init_client(fetch(CLIENT_WASM));
      return perspective.worker();
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

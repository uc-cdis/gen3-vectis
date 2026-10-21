import type { SiemApi } from './client';
import { createLiveApi } from './client';
import type { createFixtureApi } from './fixtureApi';

export { ApiError } from './client';
export type { SiemApi, CallInput } from './client';
export type { ApiMap, RouteName } from './routes';

/**
 * Fixtures are for development and tests only. They are used only when explicitly requested with
 * NEXT_PUBLIC_SIEM_MODE=fixtures AND the build is not a production build. A production build can never serve
 * them: the branch below is removed at build time, so no fixture data reaches the production bundle.
 */
export function createApi(): SiemApi {
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_SIEM_MODE === 'fixtures') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./fixtureApi') as { createFixtureApi: typeof createFixtureApi }).createFixtureApi();
  }
  return createLiveApi(undefined, { graphViaGateway: true, rowsViaGateway: true });
}

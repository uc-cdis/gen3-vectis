import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getRouteConfig } from './lib/auth/arboristConfig';
import { getLoginStatus, type LoginStatus } from './lib/auth/getLoginStatus';
import { fetchArboristResources } from './lib/auth/fetchAuthz';
import type { RouteConfig } from '@gen3/frontend/server';
import { getAccessToken } from '@gen3/frontend/server';

const WILDCARD_ROUTE_KEY = '*';

function getRouteRuleForPath(pathname: string, routeConfig: RouteConfig) {
  // handle wildcards
  // get subdirectory
  const pathParts = pathname.split('/');
  // has subdirectory
  if (pathParts.length > 2) {
    const startsWithPath = `/${pathParts[1]}`;
    // look through config for subdirectory
    const routeConfigMatch = Object.keys(routeConfig).find((key) =>
      key.startsWith(startsWithPath),
    );
    // check if subdirectory ends with wildcard
    if (routeConfigMatch?.endsWith('(.*)')) {
      return routeConfig?.[routeConfigMatch];
    }
  }
  return routeConfig?.[pathname] ?? routeConfig?.[WILDCARD_ROUTE_KEY];
}

function isLoggedIn(loginStatus: LoginStatus) {
  return loginStatus.status === 'issued';
}

/**
 * Development only: the synthetic-fixture pages under /dev (see e2e/ and src/pages/dev) need no login when DEV_PAGES_NO_LOGIN=1.
 * A production build never takes this branch, whatever the variable says, and those pages answer 404 there anyway.
 */
export function isDevPageWithoutLogin(pathname: string, env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.DEV_PAGES_NO_LOGIN === '1' && pathname.startsWith('/dev/');
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (isDevPageWithoutLogin(pathname)) return NextResponse.next();
  const { routes: routeConfig } = await getRouteConfig();
  let rule = getRouteRuleForPath(pathname, routeConfig);

  // check if there is a wildcard route
  if (!rule) {
    rule = getRouteRuleForPath('*', routeConfig);
  }

  // Fail closed: a page with no rule (not even the "*" rule) needs a login, like every other page. A page is public only
  // when authz.json says so with an explicit `"loginRequired": false`.
  const loginRequired = rule?.loginRequired ?? true;

  if (!loginRequired) {
    return NextResponse.next();
  }

  // Gen3 login check
  const loginStatus = await getLoginStatus(req.headers.get('Cookie') || '');
  const loggedIn = isLoggedIn(loginStatus);

  // Enforce login if required
  if (!loggedIn) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/Login';
    loginUrl.searchParams.set('referer', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const needsAuthz = Array.isArray(rule?.authz) && rule?.authz.length > 0;

  // If no authz resources configured, login is enough
  if (!needsAuthz) {
    return NextResponse.next();
  }

  // Authz is enabled, AND route has authzResources → check Arborist resources
  const tokenFromCookie =
    getAccessToken(req.headers.get('Cookie') || '') ?? null;

  // Let the server-side helper resolve resources using the active Gen3 session.
  const resources = await fetchArboristResources(
    tokenFromCookie,
    process.env.NODE_ENV === 'production',
  );

  const allowed = rule?.authz!.some((needed) => resources.includes(needed));
  if (!allowed) {
    // Already logged in if required; they just lack authz for this resource
    const forbiddenUrl = req.nextUrl.clone();
    // Ceck for 403 redirect
    if (rule?.redirect403 ) {
      return NextResponse.redirect(new URL(rule.redirect403, req.url));
    }

    forbiddenUrl.pathname = '/403';
    // The rewritten page renders "Not Authorized" content, but without an explicit status override
    // NextResponse.rewrite() replies 200: a WAF, uptime check, or log-based alert keyed on 403s would
    // never see this denial.
    return NextResponse.rewrite(forbiddenUrl, { status: 403 });
  }

  return NextResponse.next();
}

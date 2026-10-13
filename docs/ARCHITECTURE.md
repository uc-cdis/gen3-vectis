# Architecture: the Vectis security console

The portal is the Gen3 frontend template plus one product: a security console (Overview, Alerts, Investigate, Cases,
Detection). The console is one implementation behind five pages. Everything it shows comes from the backend
(`siem-app`); the portal stores nothing.

## Pieces

| Path | What it is |
|---|---|
| `src/pages/{Security,Alerts,Investigate,Cases,Detection}.tsx` | One line each: `securityPage('/Path')`. Same shell, different tabs. |
| `src/components/security/` | The console. `SecurityShell` renders a page's tabs; `context.tsx` holds the URL-synced state (time range, tab, open alert/entity) and `SECTIONS`, the page/tab map. Folders are by feature (`alerts/`, `cases/`, `hunt/`, `intel/`, `health/`, `drawers/` ...); each tab is `tabs/<Name>Tab.tsx`. |
| `src/lib/vectis-kit/` | Console-independent building blocks: `api/` (typed client, route table, fixture client), `spec/` (contract types, indicator syntax), `data-table/` (Perspective grid), `entity-graph/`, `timeseries/`, `explain/` ("why did this fire"), `spec-actions/` (copy as Python/curl/GraphQL), `entity-card/`, `ui/` (formats, primitives). |
| `src/pages/api/siem/[...route].ts` + `src/lib/siem/bff.ts` | The server-side proxy (below). |
| `src/lib/upstream.ts` | The one bounded HTTP call every server-side proxy uses: deadline, no redirects, body cap, no upstream detail. |
| `config/gen3/*.json` | Navigation, theme, landing page and `authz.json` (which Arborist resource each route needs). `src/proxy.ts` is GENERATED from `authz.json` by `npm run build:middlewarePaths`; never edit it. |
| `src/pages/dev/security.tsx` | Development-only page: the console over synthetic fixtures, no login. 404 in production. |

## Data flow

```
browser (SecurityShell, tabs)
  -> typed client  (vectis-kit/api/client.ts)      GET/POST /api/siem/<route>   same-origin, cookie
  -> portal proxy  (pages/api/siem/[...route].ts)  route allowlist -> same-origin write check -> authorize() -> callUpstream()
  -> siem-app      /siem/<route>                   Bearer <user token> + x-auth-request-user: <verified user>
```

Server-side rules (each has a test in `src/lib/siem/*.test.ts` or `src/lib/upstream.test.ts`):

- Only routes in `vectis-kit/api/routes.ts` are forwarded; the same table types the client. Path segments are validated, never interpolated raw.
- `authorize()` needs a valid Gen3 login AND one of the Arborist resources `config/gen3/authz.json` lists for `/Security`. A missing or empty list denies (fail closed). Permissions are cached 30 s so a revoked grant does not linger.
- Identity sent upstream is the verified user, built from scratch; the browser's cookie and any client-supplied identity header are dropped. Writes must be same-origin and JSON.
- Upstream errors reach the browser as short fixed messages; 5xx detail is never forwarded. Responses are capped (20 MB) and time-limited (25 s).
- In the browser every payload goes through `sanitizeUntrusted` before it is rendered; values that an attacker can influence are rendered as text, never as markup.

## Contract first

The backend contract (`siem-app/src/siem_service/contract.py`) is the single definition of every request and response.
`siem-app/scripts/export_frontend.py` writes three files into `src/lib/vectis-kit/spec/generated/`:

- `contract.schema.json`: the JSON Schema bundle (used by `spec/contract.test.ts` to validate fixtures with Ajv).
- `contract.generated.ts`: the TypeScript types, produced from the schema by `npm run gen:siem-types`.
- `fixtures.json`: one map `name -> response` of synthetic samples plus an anchor timestamp. Each is constructed through the contract models, so it cannot disagree with them. Only tests and the dev fixture client import it; it is not in the production bundle.

Regenerate after a contract change (never edit these files by hand):

```
cd ../siem-app && uv run python scripts/export_frontend.py ../gen3-vectis/src/lib/vectis-kit/spec/generated
cd ../gen3-vectis && npm run gen:siem-types
```

`vectis-kit/spec/index.ts` is the hand-written layer on top of the generated types (aliases, `severityRank`, ...).

## Where to add things

- **A tab**: add its id to `TABS` and the page's entry in `SECTIONS` (`context.tsx`), the component to `TAB_COMPONENTS` (`SecurityShell.tsx`), and `tabs/<Name>Tab.tsx`.
- **A page**: an entry in `SECTIONS`, `src/pages/<Name>.tsx` (`securityPage`), a route in `config/gen3/authz.json`, an item in `navigation.json`, a title in `TAB_TITLES` (`_app.tsx`); then `npm run build:middlewarePaths`.
- **A backend route**: the contract first (see above), then one line in `vectis-kit/api/routes.ts` (path, method, request and response types). The proxy and the client pick it up; add a fixture handler in `api/fixtureApi.ts`.

## Tests

- `npm run test:unit` (Vitest, jsdom, about 500 tests): colocated `*.test.ts(x)`. `src/components/security/testing/render.tsx` renders a component the way the console does (theme, fixture API, URL-synced context); `testUtils.ts(x)` files hold per-folder helpers.
- `npx playwright test` (real browser against `next dev --webpack`): `e2e/*.spec.ts` drive `/dev/security` over fixtures. `e2e/support.ts` stubs the Gen3 start-up calls and collects console errors. Set `E2E_SHOTS_DIR` to write review screenshots.
- `npx tsc --noEmit -p .` also type-checks the tests; `npx oxlint .` lints.

## Development-only code

`/dev/*` pages and the fixture clients are reachable only when `NODE_ENV !== 'production'`: the pages return 404, and they load fixtures through a guarded `require` that the production build removes (checked by grepping `.next/` for fixture strings after `npm run build`).

## Environment

| Variable | Meaning |
|---|---|
| `SIEM_SERVICE_URL` | Base URL of siem-app. Else `SIEM_SERVICE_DNS` (host, port 8000), else the in-cluster service name. |
| `NEXT_PUBLIC_SIEM_MODE=fixtures` | Development only: serve fixtures instead of the proxy. Ignored in production builds. |
| `NEXT_PUBLIC_GEN3_API` | Used by Playwright to point the app shell at the test server. |

import { mkdirSync } from 'node:fs';
import { expect } from 'playwright/test';
import type { Page } from 'playwright/test';

/** Requests the Gen3 app shell makes to the commons services at start-up. Answered locally; nothing leaves the machine. */
const COMMONS = /\/(_status|user|lw-workspace|job|mds|authz|guppy|manifests|wts|library|dashboard|requestor|index)(\/|$)/;

/**
 * The console page lives inside the Gen3 app shell, which refuses to render without a CSRF answer from `/_status` and
 * treats a 401 from the user endpoints as "not signed in". Answer exactly that, so the page under test is the real one
 * and the data in it is the synthetic fixtures served by the console's own API layer.
 */
export async function stubCommons(page: Page): Promise<void> {
  await page.route((url) => url.origin === 'http://localhost:3101' && COMMONS.test(url.pathname), (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/_status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'OK', csrf: 'e2e' }) });
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });
}

export interface PageErrors { uncaught: string[]; consoleErrors: string[] }

/**
 * Collects uncaught exceptions and console errors.
 * Two kinds of console error are not ours and are set aside, never silently: the 401s that the start-up stub above
 * returns on purpose, and the framework's own development accessibility reporter (its "Fix any/all of the following"
 * groups describe the shell's header and footer). Everything else counts.
 */
export function watchErrors(page: Page): PageErrors {
  const out: PageErrors = { uncaught: [], consoleErrors: [] };
  page.on('pageerror', (e) => out.uncaught.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/^Fix (any|all) of the following/.test(text)) return;
    if (/Failed to load resource/.test(text) && COMMONS.test(new URL(m.location().url || 'http://x/').pathname)) return;
    out.consoleErrors.push(text);
  });
  return out;
}

/** The page under test, with the commons stubbed and errors collected. `url` is relative to the dev server. */
export async function openDev(page: Page, url: string): Promise<PageErrors> {
  const errors = watchErrors(page);
  await stubCommons(page);
  await page.goto(url);
  return errors;
}

export const expectClean = (e: PageErrors): void => {
  expect(e.uncaught).toEqual([]);
  expect(e.consoleErrors).toEqual([]);
};

const SHOTS = process.env.E2E_SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Review screenshots: written only when E2E_SHOTS_DIR is set (outside the repository). `settleMs` waits for animation, and only then. */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean; settleMs?: number } = {}): Promise<void> {
  if (!SHOTS) return;
  if (opts.settleMs) await page.waitForTimeout(opts.settleMs);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: opts.fullPage ?? true });
}

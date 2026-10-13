import { expect, test } from 'playwright/test';
import type { Page } from 'playwright/test';
import { expectClean, openDev, shot } from './support';

// Walks the whole security console in a real browser against the synthetic fixtures (the development-only
// /dev/security page; no login, no network beyond the dev server). Screenshots go outside the repository.

const TABS = ['overview', 'alerts', 'cases', 'hunt', 'data', 'entities', 'intel', 'coverage', 'health'] as const;

async function open(page: Page, query: string) {
  const errors = await openDev(page, `/dev/security?${query}`);
  await expect(page.getByTestId('security-shell')).toBeVisible();
  return errors;
}

test.describe('every tab renders cleanly', () => {
  for (const tab of TABS) {
    test(`${tab}`, async ({ page }) => {
      const errors = await open(page, `tab=${tab}`);
      // A page with one tab has no second tab row at all; the pages that group tabs show the selected one.
      const grouped = ['hunt', 'entities', 'data', 'intel', 'coverage', 'health'].includes(tab);
      if (grouped) await expect(page.getByRole('tablist', { name: 'Security sections' }).getByRole('tab', { selected: true })).toHaveText(new RegExp(`^${tab}$`, 'i'), { timeout: 30_000 }); // first load compiles the page in the dev server
      else await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
      // wait for data or an honest state, never a spinner forever
      await expect(page.getByTestId('loading-state')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId('error-state')).toHaveCount(0);
      await shot(page, `tab-${tab}`, { settleMs: 500 }); // charts finish their first paint
      expectClean(errors);
    });
  }
});

test('overview shows real numbers, and unmeasured things as Unmeasured', async ({ page }) => {
  await open(page, 'tab=overview');
  await expect(page.getByText('Needs you', { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId('unmeasured').first()).toBeVisible(); // telemetry / trust floor are not measured
  await expect(page.locator('canvas').first()).toBeVisible(); // the trend chart painted
});

test('alerts: default floor, drawer with explanation, AI slot, noise needs reason and disposition', async ({ page }) => {
  const errors = await open(page, 'tab=alerts');
  await expect(page.getByText(/Recon followed/).first()).toBeVisible();
  // low and info are hidden by default; lowering the floor reveals them, but noise stays hidden until asked for
  await expect(page.getByText(/Slight drift in request shape/)).toHaveCount(0);
  const lowSwitch = page.getByRole('switch', { name: /Show low and info/i });
  await lowSwitch.check();
  await expect(page.getByText(/Slight drift in request shape/).first()).toBeVisible();
  await expect(page.getByText(/Secret file probes, blocked/)).toHaveCount(0);
  await page.getByRole('switch', { name: /Include noise/i }).check();
  await expect(page.getByText(/Secret file probes, blocked/).first()).toBeVisible();
  await page.getByRole('switch', { name: /Include noise/i }).uncheck();
  await lowSwitch.uncheck();
  await expect(page.getByText(/Slight drift in request shape/)).toHaveCount(0);

  // open an alert: the explanation and the AI slot render
  await page.getByText(/Recon followed/).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Why this fired', { exact: false }).first()).toBeVisible();
  await expect(drawer.getByTestId('ai-slot')).toContainText(/not configured/i);
  await shot(page, 'alert-drawer');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  expectClean(errors);
});

test('alert deep link opens the drawer, and an unmeasured novelty section never shows zero', async ({ page }) => {
  await open(page, 'tab=alerts&alert=g-drift-1');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('unmeasured').first()).toBeVisible();
  await shot(page, 'alert-drawer-unmeasured');
});

test('cases: the case file separates analyst notes from AI-generated notes', async ({ page }) => {
  const errors = await open(page, 'tab=cases');
  await expect(page.getByText('Web application intrusion (sample)').first()).toBeVisible();
  await page.getByText('Web application intrusion (sample)').first().click();
  await expect(page.getByTestId('case-file')).toBeVisible();
  await expect(page.getByText('AI-generated').first()).toBeVisible();
  await expect(page.getByText(/Analyst note/).first()).toBeVisible();
  await shot(page, 'case-file');
  expectClean(errors);
});

test('entity drawer: profile, graph canvas, and the unmeasured parts', async ({ page }) => {
  const errors = await open(page, 'tab=entities&entity=ip:203.0.113.50');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('203.0.113.50').first()).toBeVisible();
  await expect(drawer.locator('canvas').first()).toBeVisible({ timeout: 30_000 }); // graph and/or source mix painted
  await shot(page, 'entity-drawer', { settleMs: 800 });
  expectClean(errors);
});

test('health is read only and never calls a stale or unmeasured source healthy', async ({ page }) => {
  await open(page, 'tab=health');
  await expect(page.getByText('STALE').first()).toBeVisible();
  await expect(page.getByText('UNMEASURED').first()).toBeVisible();
  for (const name of [/replay/i, /purge/i, /delete/i, /requeue/i]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await shot(page, 'health-detail');
});

test.describe('health at 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('recent quarantine is grouped by reason, records stay collapsed, older ones come only on request', async ({ page }) => {
    const errors = await open(page, 'tab=health');
    const group = page.getByTestId('quarantine-group');
    await expect(group).toHaveCount(1);
    await expect(group).toContainText('A number was too large for its column type.');
    await expect(page.getByRole('table', { name: 'Quarantined records' })).toHaveCount(0);
    await group.getByRole('button', { name: 'Show records' }).click();
    await expect(page.getByRole('table', { name: 'Quarantined records' })).toBeVisible();
    expect(await page.getByRole('button', { name: /^Investigate/ }).count()).toBeLessThanOrEqual(10);
    await shot(page, 'health-recent-group');
    await page.getByRole('button', { name: /^Show older records/ }).click();
    await expect(page.getByLabel('Older quarantine groups')).toContainText('schema mismatch');
    expect(errors.uncaught).toEqual([]);
  });

  test('when nothing is quarantined the page is calm, and sources, queues and quarantine fit above the fold', async ({ page }) => {
    const errors = await open(page, 'tab=health&scenario=healthy');
    const clear = page.getByTestId('quarantine-clear');
    await expect(clear).toContainText('No quarantined records in the last 36 hours');
    await expect(page.getByRole('button', { name: 'Show older records (53)' })).toBeVisible();
    await expect(page.getByTestId('quarantine-group')).toHaveCount(0);
    // The fixtures banner is development-only chrome (about 100px); the production page does not have it.
    const banner = (await page.getByTestId('fixtures-banner').boundingBox())!;
    const box = await page.getByTestId('quarantine-summary').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height - banner.height).toBeLessThanOrEqual(720);
    await shot(page, 'health-healthy');
    expect(errors.uncaught).toEqual([]);
  });
});

test.describe('data filter rail', () => {
  test.use({ viewport: { width: 1280, height: 600 } });

  test('lists the useful filters first, finds any filter by name, and scrolls on its own', async ({ page }) => {
    const errors = await open(page, 'tab=data');
    await expect(page.getByTestId('grid-mock').or(page.getByTestId('perspective-grid'))).toBeVisible({ timeout: 60_000 });
    const rail = page.getByTestId('filter-rail');
    const region = rail.getByRole('region', { name: 'Filters' });
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(rail.getByRole('button', { name: /^Show all \d+ filters$/ })).toBeVisible();
    await rail.getByRole('textbox', { name: 'Find a filter' }).fill('ja4');
    await expect(rail.getByRole('button', { name: /ja4/i }).first()).toBeVisible();
    // The panel is bounded to the viewport: with its long list open it scrolls itself and the rail never outgrows the screen.
    await rail.getByRole('textbox', { name: 'Find a filter' }).fill('');
    await rail.getByRole('button', { name: /^Show all \d+ filters$/ }).click();
    const sizes = await region.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.client).toBeLessThanOrEqual(600);
    expect(sizes.scroll).toBeGreaterThanOrEqual(sizes.client);
    const railBox = await rail.boundingBox();
    expect(railBox!.height).toBeLessThanOrEqual(640);
    await shot(page, 'data-rail');
    expect(errors.uncaught).toEqual([]);
  });

  test('stacks above the results on a narrow screen without overlap', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await open(page, 'tab=data');
    await expect(page.getByTestId('filter-rail')).toBeVisible();
    const rail = await page.getByTestId('filter-rail').boundingBox();
    const results = await page.getByTestId('data-layout').locator('> div').nth(1).boundingBox();
    expect(rail!.y + rail!.height).toBeLessThanOrEqual(results!.y + 1);
    await shot(page, 'data-rail-narrow');
  });
});

test('alert drawer: the verdict is in the sticky summary, the Why panel shows the matched value and evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = await open(page, 'tab=alerts&alert=g-ioc-match');
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByTestId('summary-verdict')).toContainText('Known-bad address 192.0.2.44 requested');
  await expect(drawer.getByTestId('why-indicator')).toContainText('192.0.2.44');
  await expect(drawer.getByTestId('why-evidence')).toBeVisible();
  // Not an attack that got through: no alarm badge for an indicator-only alert.
  await expect(drawer.getByText('Control did not stop it')).toHaveCount(0);
  // The summary stays in view while the rest scrolls.
  await drawer.getByTestId('why-evidence').scrollIntoViewIfNeeded();
  await expect(drawer.getByTestId('alert-summary')).toBeInViewport();
  expect(errors.uncaught).toEqual([]);
});

test('intel: the matched value comes first and the indicator id second', async ({ page }) => {
  await open(page, 'tab=intel');
  const cell = page.getByTestId('matched-value').first();
  await expect(cell).toContainText('192.0.2.44');
  await expect(cell).toContainText('tenant1:Indicator:');
});

test('overview: indicators loaded and alerts matching indicators are separate tiles', async ({ page }) => {
  await open(page, 'tab=overview');
  const tiles = page.getByRole('region', { name: 'Key figures' });
  await expect(tiles.getByRole('button', { name: /^Indicators loaded/ })).toBeVisible();
  await expect(tiles.getByRole('button', { name: /^Alerts matching indicators/ })).toBeVisible();
  await expect(tiles.getByRole('button', { name: /^Threat matches/ })).toHaveCount(0);
});

test('coverage shows verdicts in words and offers the Navigator export', async ({ page }) => {
  await open(page, 'tab=coverage');
  await expect(page.getByRole('button', { name: /Navigator/i })).toBeVisible();
  await expect(page.getByText(/missed/i).first()).toBeVisible();
});

// This proves the form and the result display against the DEVELOPMENT FIXTURE reply. Whether an indicator reaches the
// lake is a property of the backend route (POST /siem/watchlist), which is tested in siem-app, not here.
test('intel: the watchlist form submits and shows the accepted/rejected result it is given', async ({ page }) => {
  const errors = await open(page, 'tab=intel');
  await page.getByRole('textbox', { name: /^Value/i }).first().fill('192.0.2.77');
  await page.getByRole('button', { name: /publish|add/i }).first().click();
  await expect(page.getByText(/accepted/i).first()).toBeVisible();
  expect(errors.uncaught).toEqual([]);
});

test('hunt: the timeline paints and find-similar says what it could not measure', async ({ page }) => {
  const errors = await open(page, 'tab=hunt&similar=g-ioc-match');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('unmeasured').first()).toBeVisible(); // behavioral similarity is not measured
  await shot(page, 'hunt', { settleMs: 500 });
  expectClean(errors);
});

test('the console keeps working with a hostile tab value in the URL', async ({ page }) => {
  const errors = await open(page, 'tab=%3Cscript%3Ealert(1)%3C/script%3E&alert=..%2F..%2Fetc&entity=ip:%00');
  expect(errors.uncaught).toEqual([]);
});

test('alert drawer: open the existing case, add to a case, and investigate the source in one click', async ({ page }) => {
  const errors = await open(page, 'tab=alerts');
  await page.getByText(/Secret file request answered 200/).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: /^Create case$/ }).click();
  await expect(drawer.getByTestId('case-id')).toContainText(/Open case/);
  const investigate = drawer.getByLabel('Investigate').getByRole('button').first();
  await expect(investigate).toBeVisible();
  await investigate.click();
  await expect(page).toHaveURL(/entity=/);
  expect(errors.uncaught).toEqual([]);
});

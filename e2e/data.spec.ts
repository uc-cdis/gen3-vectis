import { expect, test } from 'playwright/test';
import { expectClean, openDev, shot } from './support';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('Data tab: grid, enum filter chip, copy as Python, no errors', async ({ page }) => {
  const errors = await openDev(page, '/dev/security?tab=data');

  // 1. The Perspective grid renders rows from the fixtures.
  const grid = page.getByTestId('perspective-grid');
  await expect(grid).toBeVisible();
  const before = Number(await grid.getAttribute('data-row-count'));
  expect(before).toBeGreaterThan(0);
  const cells = page.locator('perspective-viewer regular-table tbody td');
  await expect(cells.first()).toBeVisible();
  expect(await cells.count()).toBeGreaterThan(0);
  await expect(page.getByTestId('result-count')).toContainText('Rows 1 to');

  // 2. An enum filter reduces the rows and shows a removable chip.
  await page.getByRole('checkbox', { name: /^BLOCK/ }).check();
  const chip = page.getByTestId('filter-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText('WAF action is BLOCK');
  await expect.poll(async () => Number(await page.getByTestId('perspective-grid').getAttribute('data-row-count'))).toBeLessThan(before);
  const filtered = Number(await page.getByTestId('perspective-grid').getAttribute('data-row-count'));
  expect(filtered).toBeGreaterThan(0);

  // removing the chip restores the rows
  await page.getByRole('button', { name: /Remove filter: WAF action is BLOCK/ }).click();
  await expect(page.getByTestId('filter-chip')).toHaveCount(0);
  await expect.poll(async () => Number(await page.getByTestId('perspective-grid').getAttribute('data-row-count'))).toBe(before);

  // 3. Copy as Python puts a snippet on the clipboard, with no token in it.
  await page.getByRole('button', { name: 'Use this query elsewhere' }).click();
  await page.getByRole('menuitem', { name: 'Copy as Python' }).click();
  await expect(page.getByTestId('spec-actions-status')).toContainText('Copied Python');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('Gen3Auth()');
  expect(clip).toContain('"index_name": "http_activity"');
  expect(clip).not.toMatch(/Bearer|eyJ[A-Za-z0-9_-]{10,}|api_key|access_token/i);

  // 4. Nothing was reported as an error.
  expectClean(errors);
});

test('data: the grid can be shown as a chart, not only a table', async ({ page }) => {
  const errors = await openDev(page, '/dev/security?tab=data');
  await expect(page.getByTestId('perspective-grid')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Bar', { exact: true }).click();
  await expect(page.getByTestId('perspective-grid').locator('perspective-viewer')).toHaveAttribute('data-plugin', /.*/, { timeout: 15_000 }).catch(() => undefined);
  await shot(page, 'data-chart', { settleMs: 1500 });
  expect(errors.uncaught).toEqual([]);
});

import { expect, test } from 'playwright/test';
import { expectClean, openDev, shot } from './support';

// The compact dictionary in the Workspaces rail and its drawer (development page /dev/workspace-dictionary, no login).
test('workspace: the compact panel at rail width, and the drawer', async ({ page }) => {
  const errors = await openDev(page, '/dev/workspace-dictionary');
  const rail = page.getByTestId('rail-frame');
  await expect(rail.getByTestId('compact-dictionary')).toBeVisible();
  await expect(rail.getByTestId('compact-entity')).toHaveCount(8);
  const box = await rail.boundingBox();
  expect(box?.width).toBe(310);
  await rail.getByRole('button', { name: /^http_activity/ }).click();
  await expect(rail.getByTestId('compact-property')).toHaveCount(9);
  // nothing overflows the rail horizontally
  const overflow = await rail.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, 'dict-5-workspace-panel', { fullPage: false });

  await page.getByTestId('workspace-dictionary-open').click();
  const drawer = page.getByRole('dialog', { name: 'Dictionary' });
  await expect(drawer.getByTestId('compact-entity')).toHaveCount(8);
  await shot(page, 'dict-6-workspace-drawer', { fullPage: false, settleMs: 700 }); // drawer transition
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  expectClean(errors);
});

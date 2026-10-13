import { expect, test } from 'playwright/test';
import { openDev, shot } from './support';

// The console's five pages and the top navigation, each in its own right.

// The top-level navigation: every console section is a top-level item, and the unused Gen3 pages are not in it.
test('the top navigation lists the console sections and not the retired pages', async ({ page }) => {
  await openDev(page, '/dev/security?tab=alerts');
  for (const name of ['Overview', 'Alerts', 'Investigate', 'Cases', 'Detection', 'Apps', 'Dictionary', 'Workspaces', 'Profile']) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  for (const gone of ['Data Library', 'Exploration', 'Query', 'Analysis']) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  await shot(page, 'nav', { fullPage: false });
});

const PAGES: [string, string[]][] = [
  ['/Security', []], ['/Alerts', []], ['/Cases', []],
  ['/Investigate', ['Hunt', 'Entities', 'Data']], ['/Detection', ['Intel', 'Coverage', 'Health']],
];

for (const [path, tabs] of PAGES) {
  test(`${path} renders as its own page${tabs.length ? ` with ${tabs.join(', ')}` : ' with no second tab row'}`, async ({ page }) => {
    const errors = await openDev(page, `/dev/security?section=${encodeURIComponent(path)}`);
    await expect(page.getByTestId('security-shell')).toBeVisible();
    await expect(page.getByTestId('loading-state')).toHaveCount(0, { timeout: 30_000 });
    const rows = page.getByRole('tab');
    await expect(rows).toHaveCount(tabs.length);
    for (const t of tabs) await expect(page.getByRole('tab', { name: t, exact: true })).toBeVisible();
    await shot(page, `section${path.replace('/', '-')}`, { fullPage: false, settleMs: 600 });
    expect(errors.uncaught).toEqual([]);
  });
}

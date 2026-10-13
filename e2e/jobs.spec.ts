import { expect, test } from 'playwright/test';
import type { Page } from 'playwright/test';
import { expectClean, openDev, shot } from './support';

// Jobs in a real browser against the synthetic fixtures (the development-only /dev/jobs page; no login).
async function open(page: Page, query = '') {
  const errors = await openDev(page, `/dev/jobs?fast=1${query}`);
  await expect(page.getByTestId('jobs-shell')).toBeVisible();
  return errors;
}

test('catalog renders the jobs, the version, and the definitions that failed', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByTestId('job-card')).toHaveCount(6);
  await expect(page.getByTestId('kind-badge').filter({ hasText: 'Workflow · dagu' })).toHaveCount(3);
  await expect(page.getByTestId('catalog-source')).toContainText('example-org/vectis-jobs@main');
  await expect(page.getByText('Secret values are never shown')).toBeVisible();
  await page.getByRole('button', { name: '1 definition could not be loaded' }).click();
  await expect(page.getByText('broken-job.yaml')).toBeVisible();
  await shot(page, 'jobs-catalog');
  await page.getByRole('button', { name: 'Details of Log summary' }).click();
  await expect(page.getByRole('list', { name: /Steps of Log summary/ })).toBeVisible();
  await expect(page).toHaveURL(/job=log-summary/);
  await shot(page, 'jobs-job-details');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expectClean(errors);
});

test('run a job end to end: invalid is blocked, valid submits, the run progresses to COMPLETE with logs', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Run Log summary' }).click();
  const dlg = page.getByRole('dialog');
  const run = dlg.getByRole('button', { name: 'Run job' });
  await expect(run).toBeDisabled();
  await dlg.getByLabel(/Log file/).fill('not a url');
  await expect(dlg.getByText('Must be an s3://bucket/key URL.')).toBeVisible();
  await expect(run).toBeDisabled();
  await dlg.getByLabel(/Log file/).fill('s3://my-bucket/logs/app.log');
  await dlg.getByLabel(/Result location/).fill('s3://my-bucket/out/result.json');
  await expect(run).toBeEnabled();
  await expect(dlg.getByLabel('What will be sent')).toContainText('"vectis.job": "log-summary"');
  await expect(dlg.getByLabel('What will be sent')).not.toContainText('PYTHONUNBUFFERED": "1');
  await shot(page, 'jobs-run-dialog');
  await run.click();

  const drawer = page.getByRole('dialog');
  await expect(page).toHaveURL(/run=run-01\d\d/);
  await expect(drawer.getByTestId('state-badge')).toHaveText(/Queued|Running|Succeeded/);
  await expect(drawer.getByTestId('state-badge')).toHaveText('Succeeded', { timeout: 20_000 });
  await expect(drawer.getByLabel('Step 1 stdout', { exact: true })).toContainText('finished without errors');
  await shot(page, 'jobs-run-complete');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Log summary.*Succeeded.*you/ }).first()).toBeVisible();
  expectClean(errors);
});

test('runs table: states as text, state filter, paging, auto refresh note', async ({ page }) => {
  const errors = await open(page, '&tab=runs');
  await expect(page.getByRole('table', { name: 'Runs' })).toBeVisible();
  for (const s of ['Running', 'Succeeded', 'Failed', 'Cancelled', 'Queued', 'Starting']) await expect(page.getByTestId('state-badge').filter({ hasText: s }).first()).toBeVisible();
  await expect(page.getByTestId('refresh-note')).toContainText('refreshing automatically');
  await shot(page, 'jobs-runs');
  await page.getByLabel('State').first().click();
  await expect(page.getByTestId('backend-state').filter({ hasText: 'PREEMPTED' })).toBeVisible(); // the runner's own word, secondary
  await page.getByRole('option', { name: 'Failed' }).click();
  await expect(page.getByRole('table', { name: 'Runs' }).getByRole('row')).toHaveCount(5); // header + executor error, system error, preempted, and the workflow run with a failed branch
  await page.getByLabel('Name starts with').fill('zzz');
  await expect(page.getByText('No runs match these filters')).toBeVisible();
  expectClean(errors);
});

test('detail drawer: failure banner, flow, three executors, hostile text stays text', async ({ page }) => {
  const errors = await open(page, '&run=run-0004');
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByTestId('failure-banner')).toContainText('Step 1 exited with code 2');
  await expect(drawer.getByTestId('failure-banner')).toContainText('ValueError');
  await shot(page, 'jobs-run-failed');
  await page.keyboard.press('Escape');

  await page.goto('/dev/jobs?fast=1&run=run-0010');
  await expect(page.getByRole('list', { name: /Steps of Three step pipeline/ })).toBeVisible();
  await expect(page.locator('[data-node="step"][data-status="success"]')).toHaveCount(3);
  await shot(page, 'jobs-run-three-steps');

  await page.goto('/dev/jobs?fast=1&run=run-0012');
  await expect(page.getByLabel('Step 1 stdout', { exact: true })).toContainText('<script>alert("xss")</script>');
  await expect(page.locator('dialog img, [role="dialog"] img[src="x"], [role="dialog"] script, [role="dialog"] b')).toHaveCount(0);
  await expect(page.getByLabel('Step 1 stdout', { exact: true })).not.toContainText('‮');
  await page.getByRole('dialog').getByText('Logs', { exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('dialog').getByLabel('Step 1 stderr', { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, 'jobs-run-hostile', { fullPage: false });
  expectClean(errors);
});

test('cancel asks first and ends in Canceled', async ({ page }) => {
  const errors = await open(page, '&run=run-0001');
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'Cancel run' }).click();
  const confirm = page.getByRole('dialog', { name: 'Cancel this run?' });
  await expect(confirm).toBeVisible();
  await shot(page, 'jobs-cancel-confirm');
  await confirm.getByRole('button', { name: 'Cancel run' }).click();
  await expect(drawer.getByTestId('state-badge')).toHaveText('Cancelled');
  await expect(page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
  expectClean(errors);
});

test('a catalog that is not configured says so', async ({ page }) => {
  const errors = await open(page, '&catalog=none');
  await expect(page.getByTestId('catalog-unconfigured')).toContainText('TES_CATALOG_REPO');
  await expect(page.getByTestId('job-card')).toHaveCount(0);
  await shot(page, 'jobs-not-configured');
  expectClean(errors);
});

test('workflow (DAG) runs: parallel branches drawn left to right, a failed branch, arrows only between dependent steps', async ({ page }) => {
  const errors = await open(page, '&run=fanout.fx0002');
  const drawer = page.getByRole('dialog');
  const flow = drawer.getByRole('list', { name: /Steps of fanout/ });
  await expect(flow).toBeVisible();
  await expect(flow).toHaveAttribute('data-layout', 'dag');
  await expect(drawer.getByTestId('failure-banner')).toContainText('Step "branch_b" exited with code 3');
  // three parallel branches share one column (same x), the join is a column to the right of all of them
  const box = async (k: string) => (await flow.locator(`[data-step="step:${k}"]`).boundingBox())!;
  const [a, b, c, j] = [await box('branch_a'), await box('branch_b'), await box('branch_c'), await box('join')];
  expect(Math.abs(a.x - b.x)).toBeLessThan(1); expect(Math.abs(b.x - c.x)).toBeLessThan(1);
  expect(a.y).toBeLessThan(b.y); expect(b.y).toBeLessThan(c.y); // stacked
  expect(j.x).toBeGreaterThan(a.x + a.width);
  await expect(flow.locator('[data-step="step:branch_b"]')).toHaveAttribute('data-status', 'failure');
  await expect(flow.locator('[data-step="step:join"]')).toHaveAttribute('data-status', 'neutral');
  await expect(page.locator('[data-testid="flow-edges"] [data-edge]')).toHaveCount(3);
  await shot(page, 'jobs-dag-failed-branch');
  await page.getByRole('tab', { name: 'branch_b' }).click();
  await expect(drawer.getByLabel('Step branch_b stderr', { exact: true })).toContainText('upstream returned 503');
  await page.keyboard.press('Escape');

  await page.goto('/dev/jobs?fast=1&run=soc-enrich-indicator.fx0003');
  await expect(page.getByRole('list', { name: /Steps of soc-enrich-indicator/ })).toBeVisible();
  await expect(page.locator('[data-step="step:enrich"]')).toHaveAttribute('data-status', 'success');
  await expect(page.locator('[data-step="step:shape"]')).toHaveAttribute('data-status', 'running');
  await expect(page.getByRole('table', { name: 'Parameters' })).toContainText('203.0.113.9');
  await shot(page, 'jobs-dag-running');
  expectClean(errors);
});

test('workflow jobs: details show the graph, the run dialog guards parameters, and a submitted workflow run completes', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Details of Fan-out and join' }).click();
  await expect(page.getByRole('list', { name: /Steps of Fan-out and join/ })).toHaveAttribute('data-layout', 'dag');
  await shot(page, 'jobs-dag-job-details');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run Fan-out and join' }).click();
  const dlg = page.getByRole('dialog');
  const run = dlg.getByRole('button', { name: 'Run job' });
  await dlg.getByLabel(/Label/).fill('a;touch x');
  await expect(dlg.getByText(/does not match the required format|may only contain letters/i)).toBeVisible();
  await expect(run).toBeDisabled();
  await dlg.getByLabel(/Label/).fill('release_7');
  await expect(run).toBeEnabled();
  await expect(dlg.getByTestId('preview')).toContainText('Workflow · dagu');
  await run.click();
  await expect(page).toHaveURL(/run=dag-fanout\.fx01|run=fanout\.fx01/);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByTestId('state-badge')).toHaveText('Succeeded', { timeout: 20_000 });
  await expect(drawer.getByRole('table', { name: 'Parameters' })).toContainText('release_7');
  expectClean(errors);
});

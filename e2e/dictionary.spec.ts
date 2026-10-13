import { SAMPLE_DICTIONARY } from '../src/lib/dictionary/sample';
import { expect, test } from 'playwright/test';
import { expectClean, openDev, shot } from './support';

// The Dictionary page against a small synthetic DDv2 dictionary, in a real browser,
// with no login. Screenshots go outside the repository.
const DDV2 = JSON.stringify(SAMPLE_DICTIONARY);

test('entity list, detail with 9 properties, sorting and filtering', async ({ page }) => {
  const errors = await openDev(page, '/dev/dictionary');
  await expect(page.getByTestId('dictionary-explorer')).toBeVisible();
  await expect(page.getByTestId('dictionary-counts')).toContainText('8 entities');
  await expect(page.getByTestId('dictionary-version')).toContainText('sample-ddv2-v1');
  await expect(page.getByTestId('dictionary-version')).toContainText('tenant-observation-envelope');
  await shot(page, 'dict-1-entities', { fullPage: false });

  await page.getByRole('button', { name: /^http_activity/ }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'http_activity' })).toBeVisible();
  await expect(page.getByTestId('property-row')).toHaveCount(9);
  await expect.poll(() => new URL(page.url()).searchParams.get('entity')).toBe('http_activity');
  // camelCase stays as the dictionary names it
  await expect(page.getByText('forwarderHost', { exact: true })).toBeVisible();
  await expect(page.getByText('forwarder_host')).toHaveCount(0);
  await shot(page, 'dict-2-http-activity', { fullPage: false });

  // sorting: ascending by name, then descending, then back to dictionary order
  const names = async () => page.getByTestId('property-row').locator('td:first-child').allInnerTexts();
  const declared = await names();
  await page.getByRole('button', { name: 'Sort by Property' }).click();
  const asc = await names();
  expect(asc).toEqual([...declared].sort((a, b) => a.localeCompare(b)));
  await page.getByRole('button', { name: 'Sort by Property' }).click();
  expect(await names()).toEqual([...asc].reverse());
  await page.getByRole('button', { name: 'Sort by Property' }).click();
  expect(await names()).toEqual(declared);

  await page.getByLabel('Filter the properties of http_activity').fill('ja3');
  await expect(page.getByTestId('property-row')).toHaveCount(1);
  expectClean(errors);
});

test('search finds entities by property name and keeps the deep link', async ({ page }) => {
  await openDev(page, '/dev/dictionary?entity=principal');
  await expect(page.getByRole('heading', { level: 3, name: 'principal' })).toBeVisible();
  await page.getByLabel('Search entities and properties').fill('forwarderHost');
  await expect(page.getByTestId('entity-item').first()).toBeVisible();
  const n = await page.getByTestId('entity-item').count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(8);
  await page.getByLabel('Search entities and properties').fill('zzzz-no-such-thing');
  await expect(page.getByTestId('no-entities')).toBeVisible();
});

test('an unknown ?entity= is reported as text and does not break the page', async ({ page }) => {
  const errors = await openDev(page, '/dev/dictionary?entity=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  await expect(page.getByText(/No entity named/)).toBeVisible();
  await expect(page.getByTestId('entity-detail')).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
  expect(errors.uncaught).toEqual([]);
});

test('relationships: graph, labels, edge types and open edge families', async ({ page }) => {
  const errors = await openDev(page, '/dev/dictionary?view=relationships');
  await expect(page.getByTestId('dictionary-relationships')).toBeVisible();
  await expect(page.getByTestId('entity-graph')).toHaveCount(2);
  await expect(page.getByTestId('open-only-cluster')).toBeVisible();
  await expect(page.getByTestId('isolated-labels')).toContainText('ServiceLog');
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('label-row')).toHaveCount(9);
  expect(await page.getByTestId('edge-row').count()).toBe(5);
  await expect(page.getByTestId('family')).toHaveCount(3);
  await expect(page.getByText('^flow:[A-Za-z0-9_]+(:[A-Za-z0-9_]+)?$')).toBeVisible();
  await page.getByTestId('entity-graph').first().scrollIntoViewIfNeeded();
  await shot(page, 'dict-3-relationships-declared', { fullPage: false, settleMs: 1200 }); // let the force layout settle
  await page.getByTestId('open-only-cluster').scrollIntoViewIfNeeded();
  await shot(page, 'dict-3b-relationships-open-family', { fullPage: false, settleMs: 800 });
  await page.getByTestId('isolated-labels').scrollIntoViewIfNeeded();
  await shot(page, 'dict-3c-relationships-isolated', { fullPage: false });
  await page.getByRole('button', { name: 'Highlight label WafRequest in the graph' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('label')).toBe('WafRequest');
  // from a label to an entity, and from an entity back to its label
  await page.getByTestId('label-row').filter({ hasText: 'WafRequest' }).getByRole('button', { name: 'http_activity' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'http_activity' })).toBeVisible();
  await expect(page.getByTestId('entity-labels')).toContainText('WafRequest');
  expectClean(errors);
});

test('the real fetch reads <API>/api/v0/submission/_dictionary/_all/', async ({ page }) => {
  let asked = '';
  await page.route('**/api/v0/submission/_dictionary/_all/', (route) => { asked = new URL(route.request().url()).pathname; return route.fulfill({ status: 200, contentType: 'application/json', body: DDV2 }); });
  await openDev(page, '/dev/dictionary?source=network');
  await expect(page.getByTestId('dictionary-counts')).toContainText('8 entities');
  expect(asked).toBe('/api/v0/submission/_dictionary/_all/');
});

test('states: unreachable service, bad payload, empty dictionary, loading', async ({ page }) => {
  await page.route('**/api/v0/submission/_dictionary/_all/', (route) => route.abort());
  await openDev(page, '/dev/dictionary?source=network');
  await expect(page.getByTestId('dictionary-error')).toContainText('could not be reached');
  await shot(page, 'dict-4-error', { fullPage: false });

  await page.unroute('**/api/v0/submission/_dictionary/_all/');
  await page.route('**/api/v0/submission/_dictionary/_all/', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"hello":"world","entities":[1]}' }));
  await page.goto('/dev/dictionary?source=network');
  await expect(page.getByTestId('dictionary-error')).toContainText('not a DDv2 dictionary');

  await page.goto('/dev/dictionary?source=empty');
  await expect(page.getByTestId('dictionary-empty')).toBeVisible();
  await page.goto('/dev/dictionary?source=hostile');
  await expect(page.getByTestId('dictionary-error')).toContainText('not allowed');
  await page.goto('/dev/dictionary?source=loading');
  await expect(page.getByTestId('loading-state')).toBeVisible();
});

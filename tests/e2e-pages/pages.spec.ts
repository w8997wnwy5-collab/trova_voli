import { expect, test } from '@playwright/test';

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const results = (page: import('@playwright/test').Page) => page.getByRole('heading', { name: /\d+ options?/ });

test('static site: search runs in the browser end to end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.getByRole('combobox', { name: 'From' }).fill('Milan');
  await page.getByRole('listbox', { name: 'From suggestions' }).getByRole('option').first().click();
  await page.getByRole('combobox', { name: 'To' }).fill('London');
  await page.getByRole('listbox', { name: 'To suggestions' }).getByRole('option').first().click();
  await page.getByRole('button', { name: 'Search flights' }).click();
  await expect(page).toHaveURL(/\/trova_voli\/search\/\?.*from=MIL/);
  await expect(results(page)).toBeVisible();
  await expect(page.getByText(/Demo data\./)).toBeVisible();
  await expect(page.getByText(/Duffel: Not configured/)).toBeVisible();

  // Client-side strategy changes keep the base path in the URL.
  await page.getByRole('radio', { name: /Comfortable/ }).click();
  await expect(page).toHaveURL(/\/trova_voli\/search\/\?.*preset=comfortable/);
  await page.getByRole('button', { name: /Trip strategy/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Trip strategy' }).getByRole('radiogroup', { name: 'Maximum stops', exact: true })).toContainText(/\d+ options?/);
  await page.keyboard.press('Escape');

  const card = page.locator('article').first();
  await card.getByRole('button', { name: /Details, costs & why/ }).click();
  await card.getByRole('tab', { name: 'Cost breakdown' }).click();
  await expect(card.getByRole('table', { name: 'Cost breakdown' })).toContainText('Total');
  await card.getByRole('button', { name: 'Save to favourites' }).click();

  await page.reload();
  await expect(results(page)).toBeVisible();
  await page.getByRole('link', { name: 'Favourites' }).click();
  await expect(page).toHaveURL(/\/trova_voli\/favorites\/$/);
  await expect(page.getByRole('link', { name: /Check today's price/ })).toHaveCount(1);
  await page.getByRole('link', { name: /Check today's price/ }).click();
  await expect(results(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('static site: flexible dates calendar and simulated outage', async ({ page }) => {
  await page.goto(`search/?trip=return&from=MIL&to=LON&mode=flexible&depart=${isoDay(40)}&return=${isoDay(43)}&flex=1&adults=1&cur=EUR&preset=balanced&simulate=fail:demo-budget`);
  await expect(results(page)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Departure dates' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Partial results' })).toContainText('Demo Budget Finder');
});

test('static site: unknown pages show the 404 page', async ({ page }) => {
  const res = await page.goto('does-not-exist/');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { isoDay, searchUrl, waitForResults } from './helpers';

test('partial provider failure keeps the other results', async ({ page }) => {
  await page.goto(searchUrl('&simulate=fail:demo-budget'));
  await waitForResults(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Partial results' })).toContainText('Demo Budget Finder');
  await expect(page.getByText(/Demo Budget Finder: Failed/)).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
});

test('validation errors are shown before searching', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Search flights' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Please check your search' });
  await expect(alert).toContainText('Choose where you fly from');
  await expect(alert).toContainText('Choose where you fly to');
  await expect(page).toHaveURL(/\/$/);
});

test('empty state explains and offers one-click relaxations', async ({ page }) => {
  await page.goto(searchUrl('&preset=custom&ms=0.h&dd=8.h&sp=0.h&ft=1.h&bi=1.h'));
  await expect(page.getByRole('heading', { name: /No itinerary matches your must-have rules/ })).toBeVisible({ timeout: 30_000 });
  const fix = page.getByRole('button', { name: /options from/ }).first();
  await expect(fix).toBeVisible();
  await fix.click();
  await waitForResults(page);
});

test('flexible dates show a price calendar that filters results', async ({ page }) => {
  await page.goto(`/search?trip=return&from=MIL&to=LON&mode=flexible&depart=${isoDay(40)}&return=${isoDay(43)}&flex=2&adults=1&cur=EUR&preset=balanced`);
  await waitForResults(page);
  const calendar = page.getByRole('group', { name: 'Departure dates' });
  await expect(calendar).toBeVisible();
  const day = calendar.getByRole('button', { name: /from €/ }).first();
  await day.click();
  await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole('heading', { name: /departing/ })).toBeVisible();
  await page.getByRole('button', { name: 'Show all dates' }).click();
  await expect(page).not.toHaveURL(/date=/);
});

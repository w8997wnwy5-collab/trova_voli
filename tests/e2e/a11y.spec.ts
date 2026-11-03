import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { searchUrl, waitForResults } from './helpers';

async function seriousViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`);
}

test('home page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Search flights' })).toBeEnabled();
  expect(await seriousViolations(page)).toEqual([]);
});

test('results page and strategy drawer have no serious accessibility violations', async ({ page }) => {
  await page.goto(searchUrl());
  await waitForResults(page);
  await page.locator('article').first().getByRole('button', { name: /Details, costs & why/ }).click();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole('button', { name: /Trip strategy/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Trip strategy' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('core flow works with the keyboard only', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'From' }).focus();
  await page.keyboard.type('Rome');
  await expect(page.getByRole('listbox', { name: 'From suggestions' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue(/Rome/);
  await page.getByRole('combobox', { name: 'To' }).focus();
  await page.keyboard.type('Paris');
  await expect(page.getByRole('listbox', { name: 'To suggestions' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Search flights' }).focus();
  await page.keyboard.press('Enter');
  await waitForResults(page);
});

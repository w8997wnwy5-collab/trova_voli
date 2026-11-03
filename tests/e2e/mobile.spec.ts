import { expect, test } from '@playwright/test';
import { searchUrl, waitForResults } from './helpers';

test('results are usable on a phone without horizontal scrolling', async ({ page }) => {
  await page.goto(searchUrl());
  await waitForResults(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: /Trip strategy/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Trip strategy' })).toBeVisible();
});

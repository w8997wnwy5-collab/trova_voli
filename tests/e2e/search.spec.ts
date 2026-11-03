import { expect, test } from '@playwright/test';
import { optionCount, pickLocation, searchUrl, waitForResults } from './helpers';

test('main journey: search, compare strategies, inspect, favourite, share', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /cheapest practical way to fly/i })).toBeVisible();
  await pickLocation(page, 'From', 'Milan');
  await pickLocation(page, 'To', 'London');
  await page.getByRole('button', { name: 'Search flights' }).click();

  await expect(page).toHaveURL(/\/search\?.*from=MIL.*to=LON/);
  await waitForResults(page);
  await expect(page.getByText(/Demo data\./)).toBeVisible();
  for (const title of ['Best value', 'Cheapest', 'Fastest']) {
    await expect(page.getByRole('button', { name: new RegExp(title, 'i') }).first()).toBeVisible();
  }
  const initial = await optionCount(page);
  expect(initial).toBeGreaterThan(10);

  // Presets change the result set instantly (client-side, no new search).
  await page.getByRole('radio', { name: /Comfortable/ }).click();
  await expect(page).toHaveURL(/preset=comfortable/);
  await expect(page.getByRole('radio', { name: /Comfortable/ })).toHaveAttribute('aria-checked', 'true');
  const comfortable = await optionCount(page);
  expect(comfortable).toBeLessThanOrEqual(initial);

  // Trip strategy drawer shows the impact of each choice before applying it.
  await page.getByRole('button', { name: /Trip strategy/ }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Trip strategy' });
  await expect(drawer).toBeVisible();
  const stops = drawer.getByRole('radiogroup', { name: 'Maximum stops' });
  const directOption = stops.getByRole('radio', { name: /Direct only/ });
  await expect(directOption).toContainText(/\d+ options?/);
  const directCount = Number(/(\d+) option/.exec(await directOption.innerText())![1]);
  await drawer.getByRole('radiogroup', { name: /Maximum stops: must-have or preference/ }).getByRole('radio', { name: 'Must' }).click();
  await directOption.click();
  await expect(drawer.getByText(new RegExp(`^${directCount} options? match`))).toBeVisible();
  await drawer.getByRole('button', { name: /Show \d+ options/ }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/ms=0\.h/);
  expect(await optionCount(page)).toBe(directCount);
  await expect(page.getByRole('radio', { name: /Custom/ })).toHaveAttribute('aria-checked', 'true');

  // Inspect the first itinerary: timeline, cost breakdown and ranking explanation.
  const card = page.locator('article').first();
  await card.getByRole('button', { name: /Details, costs & why/ }).click();
  await expect(card.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  await card.getByRole('tab', { name: 'Cost breakdown' }).click();
  await expect(card.getByRole('table', { name: 'Cost breakdown' })).toContainText(/Total for 1 traveller/);
  await card.getByRole('tab', { name: 'Why this option' }).click();
  await expect(card.getByText(/Value score/)).toBeVisible();
  await card.getByRole('tab', { name: 'Booking & risks' }).click();
  await expect(card.getByText(/Demo data — fictional airline, not bookable/).first()).toBeVisible();

  // Favourites persist locally.
  await card.getByRole('button', { name: 'Save to favourites' }).click();
  await expect(page.getByText(/Saved to favourites/)).toBeVisible();

  // The URL is the shareable state: reload restores the same strategy and results.
  const url = page.url();
  await page.reload();
  await waitForResults(page);
  expect(page.url()).toBe(url);
  expect(await optionCount(page)).toBe(directCount);

  await page.getByRole('link', { name: 'Favourites' }).click();
  await expect(page.getByRole('heading', { name: 'Favourites' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Check today's price/ })).toHaveCount(1);
});

test('compare up to three itineraries side by side', async ({ page }) => {
  await page.goto(searchUrl());
  await waitForResults(page);
  const boxes = page.getByRole('checkbox', { name: 'Compare' });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: 'Compare 2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare itineraries' });
  await expect(dialog.getByRole('table')).toContainText('Option 2');
  await expect(dialog.getByRole('table')).toContainText('Door-to-door');
});

test('sorting and the shared-itinerary focus link', async ({ page }) => {
  await page.goto(searchUrl('&sort=fastest'));
  await waitForResults(page);
  await expect(page.getByRole('radiogroup', { name: 'Sort results' }).getByRole('radio', { name: 'Fastest' })).toHaveAttribute('aria-checked', 'true');
  const id = (await page.locator('article').first().getAttribute('id'))!.replace('it-', '');
  await page.goto(searchUrl(`&focus=${id}`));
  await waitForResults(page);
  await expect(page.locator(`#it-${id}`)).toHaveClass(/ring-2/);
  await expect(page.locator(`#it-${id}`).getByRole('tab', { name: 'Timeline' })).toBeVisible();
});

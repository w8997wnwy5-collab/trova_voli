import { expect, type Page } from '@playwright/test';

export function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function searchUrl(extra = ''): string {
  return `/search?trip=return&from=MIL&to=LON&mode=exact&depart=${isoDay(40)}&return=${isoDay(43)}&adults=1&cur=EUR&preset=balanced${extra}`;
}

export async function waitForResults(page: Page) {
  await expect(page.getByRole('heading', { name: /\d+ options?/ })).toBeVisible({ timeout: 30_000 });
}

export async function pickLocation(page: Page, field: 'From' | 'To', text: string) {
  await page.getByRole('combobox', { name: field }).fill(text);
  await page.getByRole('listbox', { name: `${field} suggestions` }).getByRole('option').first().click();
}

export async function optionCount(page: Page): Promise<number> {
  const text = await page.getByRole('heading', { name: /\d+ options?/ }).innerText();
  return Number(/(\d+) option/.exec(text)![1]);
}

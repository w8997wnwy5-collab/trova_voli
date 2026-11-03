import { defineConfig, devices } from '@playwright/test';

// Smoke tests for the static GitHub Pages build. Run `npm run build:pages` first.
const PORT = Number(process.env.PAGES_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e-pages',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}/trova_voli/`, trace: 'retain-on-failure' },
  webServer: {
    command: `node scripts/serve-static.mjs ${PORT}`,
    url: `http://localhost:${PORT}/trova_voli/`,
    reuseExistingServer: !process.env.CI,
    env: { PAGES_BASE_PATH: '/trova_voli' },
  },
  projects: [{ name: 'pages', use: { ...devices['Desktop Chrome'] } }],
});

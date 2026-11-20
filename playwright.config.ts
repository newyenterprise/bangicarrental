import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';

/**
 * Browser tests at phone and desktop widths. They need a running app that is
 * connected to the (test) Supabase project: `pnpm test:e2e` starts `pnpm dev`
 * unless E2E_BASE_URL points at an already running site.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm dev', url: `${baseURL}/api/health`, reuseExistingServer: true, timeout: 120_000 },
});

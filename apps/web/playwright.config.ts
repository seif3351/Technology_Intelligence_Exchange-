import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/** Development inbox of the API under test (MAIL_DRIVER=file); e2e tests read links from it. */
export const E2E_MAIL_DIR = path.resolve(import.meta.dirname, '../../.var/e2e-mail');

/**
 * Browser tests for the critical web journeys. They run against a seeded
 * database (`pnpm db:reset`) with the API and web app; servers are started
 * automatically unless already running.
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a preinstalled Chromium.
 */
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'];

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['WEB_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    {
      command: 'pnpm --filter @atx/api start',
      url: 'http://localhost:4000/readyz',
      // Never on CI: a server started elsewhere may lack this configuration (e.g. the e2e mail inbox).
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        FEATURE_ENGAGEMENT_ACTIONS: 'true',
        LOG_LEVEL: 'warn',
        AUTH_RATE_LIMIT_PER_MINUTE: '500',
        MAIL_DRIVER: 'file',
        MAIL_DIR: E2E_MAIL_DIR,
      },
    },
    {
      // Production build by default: realistic CSP and no on-demand compilation (which can reload pages
      // mid-test). Set E2E_WEB_DEV=1 to run against `next dev` while iterating.
      command:
        process.env['E2E_WEB_DEV'] === '1'
          ? 'pnpm --filter @atx/web dev'
          : 'pnpm --filter @atx/web build && pnpm --filter @atx/web start',
      url: 'http://localhost:3000',
      // Never on CI: a server started elsewhere may lack this configuration (e.g. the e2e mail inbox).
      reuseExistingServer: !process.env['CI'],
      timeout: 300_000,
    },
  ],
});

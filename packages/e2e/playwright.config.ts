import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'vite',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5180' },
    },
    {
      name: 'nextjs',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3100' },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @bippy/e2e-vite dev --port 5180',
      port: 5180,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @bippy/e2e-next dev --port 3100',
      port: 3100,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

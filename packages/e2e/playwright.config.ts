import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const vitePort = Number(process.env.BIPPY_E2E_VITE_PORT ?? 5180);
const nextPort = Number(process.env.BIPPY_E2E_NEXT_PORT ?? 3100);
const tanstackPort = Number(process.env.BIPPY_E2E_TANSTACK_PORT ?? 3200);
const chromeExtensionTestMatch = /chrome-extension\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/web",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  workers: isCI ? 4 : undefined,
  reporter: "html",
  use: {
    channel: isCI ? "chrome" : undefined,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "vite",
      testIgnore: chromeExtensionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${vitePort}` },
    },
    {
      name: "nextjs",
      testIgnore: chromeExtensionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${nextPort}` },
    },
    {
      name: "tanstack",
      testIgnore: chromeExtensionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${tanstackPort}` },
    },
    {
      name: "chrome-extension",
      testMatch: chromeExtensionTestMatch,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @bippy/e2e-vite dev --port ${vitePort}`,
      port: vitePort,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @bippy/e2e-next dev --port ${nextPort}`,
      // Waiting on the URL (not just the port) lets webpack finish the slow
      // first compile of the page before tests start hitting it in parallel.
      url: `http://localhost:${nextPort}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @bippy/e2e-tanstack dev --port ${tanstackPort}`,
      port: tanstackPort,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});

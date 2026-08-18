import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const vitePort = Number(process.env.BIPPY_E2E_VITE_PORT ?? 5180);
const nextPort = Number(process.env.BIPPY_E2E_NEXT_PORT ?? 3100);
const tanstackPort = Number(process.env.BIPPY_E2E_TANSTACK_PORT ?? 3200);
const refreshPort = Number(process.env.BIPPY_E2E_REFRESH_PORT ?? 5190);
const refreshReact18Port = Number(process.env.BIPPY_E2E_REFRESH_18_PORT ?? 5191);
const refreshReact17Port = Number(process.env.BIPPY_E2E_REFRESH_17_PORT ?? 5192);
const chromeExtensionTestMatch = /chrome-extension\.spec\.ts/;
const refreshTestMatch = /refresh\/.*\.spec\.ts/;
// The late-load regression page exists in every refresh fixture.
const refreshReact19TestMatch = [/refresh\/react-fresh\.spec\.ts/, /refresh\/late-load\.spec\.ts/];
const refreshReact18TestMatch = [/refresh\/react-18\.spec\.ts/, /refresh\/late-load\.spec\.ts/];
const refreshReact17TestMatch = [/refresh\/react-17\.spec\.ts/, /refresh\/late-load\.spec\.ts/];
const hmrTestMatch = /hmr\/.*\.spec\.ts/;
// Production-only specs run through playwright.production.config.ts.
const productionOnlyTestMatch = [
  /production\.spec\.ts/,
  /profiling\.spec\.ts/,
  /script-tag\.spec\.ts/,
];
// Specs living in dedicated subfolders run only in their dedicated projects.
const sharedProjectTestIgnore = [
  chromeExtensionTestMatch,
  refreshTestMatch,
  hmrTestMatch,
  ...productionOnlyTestMatch,
];

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
      testIgnore: sharedProjectTestIgnore,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${vitePort}` },
    },
    {
      name: "nextjs",
      testIgnore: sharedProjectTestIgnore,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${nextPort}` },
    },
    {
      name: "tanstack",
      testIgnore: sharedProjectTestIgnore,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${tanstackPort}` },
    },
    {
      name: "refresh",
      testMatch: refreshReact19TestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${refreshPort}` },
    },
    {
      name: "refresh-react18",
      testMatch: refreshReact18TestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${refreshReact18Port}` },
    },
    {
      name: "refresh-react17",
      testMatch: refreshReact17TestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${refreshReact17Port}` },
    },
    {
      // Spawns its own vite dev server and edits fixture sources on disk,
      // so its tests must not run concurrently.
      name: "hmr",
      testMatch: hmrTestMatch,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
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
    {
      command: `pnpm --filter @bippy/e2e-refresh dev --port ${refreshPort}`,
      port: refreshPort,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @bippy/e2e-refresh-react18 dev --port ${refreshReact18Port}`,
      port: refreshReact18Port,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @bippy/e2e-refresh-react17 dev --port ${refreshReact17Port}`,
      port: refreshReact17Port,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
  ],
});

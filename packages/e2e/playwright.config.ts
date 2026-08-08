import { defineConfig, devices } from "@playwright/test";

const vitePort = Number(process.env.BIPPY_E2E_VITE_PORT ?? 5180);
const nextPort = Number(process.env.BIPPY_E2E_NEXT_PORT ?? 3100);
const tanstackPort = Number(process.env.BIPPY_E2E_TANSTACK_PORT ?? 3200);

export default defineConfig({
  testDir: "./tests/web",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "vite",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${vitePort}` },
    },
    {
      name: "nextjs",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${nextPort}` },
    },
    {
      name: "tanstack",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${tanstackPort}` },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @bippy/e2e-vite dev --port ${vitePort}`,
      port: vitePort,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @bippy/e2e-next dev --port ${nextPort}`,
      // Waiting on the URL (not just the port) lets webpack finish the slow
      // first compile of the page before tests start hitting it in parallel.
      url: `http://localhost:${nextPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @bippy/e2e-tanstack dev --port ${tanstackPort}`,
      port: tanstackPort,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

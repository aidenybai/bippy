import { defineConfig, devices } from "@playwright/test";

const vitePort = 5_181;
const nextPort = 3_101;
const tanstackPort = 3_201;

export default defineConfig({
  testDir: "./tests/web",
  testMatch: /use-fiber\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: true,
  reporter: "line",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "vite-production",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${vitePort}` },
    },
    {
      name: "nextjs-production",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${nextPort}` },
    },
    {
      name: "tanstack-production",
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${tanstackPort}` },
    },
  ],
  webServer: [
    {
      command: `nr --filter @bippy/e2e-vite build && nr --filter @bippy/e2e-vite preview --port ${vitePort}`,
      port: vitePort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `nr --filter @bippy/e2e-next build && nr --filter @bippy/e2e-next start --port ${nextPort}`,
      port: nextPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `nr --filter @bippy/e2e-tanstack build && nr --filter @bippy/e2e-tanstack preview --port ${tanstackPort}`,
      port: tanstackPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

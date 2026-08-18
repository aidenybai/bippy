import { defineConfig, devices } from "@playwright/test";

const vitePort = 5_181;
const nextPort = 3_101;
const tanstackPort = 3_201;
const profilingPort = 5_182;

const sharedProductionTestMatch = [/use-fiber\.spec\.ts/, /production\.spec\.ts/];
const profilingTestMatch = /profiling\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/web",
  fullyParallel: true,
  forbidOnly: true,
  reporter: "line",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "vite-production",
      testMatch: sharedProductionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${vitePort}` },
    },
    {
      name: "nextjs-production",
      testMatch: sharedProductionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${nextPort}` },
    },
    {
      name: "tanstack-production",
      testMatch: sharedProductionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${tanstackPort}` },
    },
    {
      name: "profiling",
      testMatch: profilingTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${profilingPort}` },
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
    {
      command: `nr --filter @bippy/e2e-profiling build && nr --filter @bippy/e2e-profiling preview --port ${profilingPort}`,
      port: profilingPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

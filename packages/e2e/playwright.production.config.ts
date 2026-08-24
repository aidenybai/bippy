import { defineConfig, devices } from "@playwright/test";

const vitePort = 5_181;
const nextPort = 3_101;
const tanstackPort = 3_201;
const reactRouterPort = 3_301;
const remixPort = 3_401;
const rsbuildPort = 3_501;
const astroPort = 3_601;
const profilingPort = 5_182;
const scriptTagPort = 5_183;
const kitchenSinkPort = 5_184;
const stressProductionPort = 5_185;
const react17UseFiberPort = 5_186;
const react18UseFiberPort = 5_187;

const sharedProductionTestMatch = [/use-fiber\.spec\.ts/, /production\.spec\.ts/];
const profilingTestMatch = /profiling\.spec\.ts/;
const scriptTagTestMatch = /script-tag\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/web",
  fullyParallel: true,
  forbidOnly: true,
  // Hydration timing on SSR production builds (astro islands especially)
  // can race the first interaction under parallel-server load.
  retries: 2,
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
      name: "react-router-production",
      testMatch: sharedProductionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${reactRouterPort}` },
    },
    {
      name: "remix-production",
      testMatch: sharedProductionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${remixPort}` },
    },
    {
      name: "rsbuild-production",
      testMatch: sharedProductionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${rsbuildPort}` },
    },
    {
      name: "astro-production",
      testMatch: sharedProductionTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${astroPort}` },
    },
    {
      name: "react-17-use-fiber-production",
      testMatch: /use-fiber\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${react17UseFiberPort}` },
    },
    {
      name: "react-18-use-fiber-production",
      testMatch: /use-fiber\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${react18UseFiberPort}` },
    },
    {
      name: "profiling",
      testMatch: profilingTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${profilingPort}` },
    },
    {
      name: "script-tag",
      testMatch: scriptTagTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${scriptTagPort}` },
    },
    {
      name: "kitchen-sink-production",
      testMatch: /kitchen-sink.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${kitchenSinkPort}` },
    },
    {
      name: "stress-production",
      testMatch: /stress\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${stressProductionPort}` },
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
      command: `nr --filter @bippy/e2e-react-router build && PORT=${reactRouterPort} nr --filter @bippy/e2e-react-router start`,
      port: reactRouterPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `nr --filter @bippy/e2e-remix build && PORT=${remixPort} nr --filter @bippy/e2e-remix start`,
      port: remixPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `nr --filter @bippy/e2e-rsbuild build && nr --filter @bippy/e2e-rsbuild preview --port ${rsbuildPort}`,
      port: rsbuildPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `nr --filter @bippy/e2e-astro build && nr --filter @bippy/e2e-astro preview --port ${astroPort}`,
      port: astroPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @bippy/e2e-use-fiber-versions build:17 && pnpm --filter @bippy/e2e-use-fiber-versions preview:17 --port ${react17UseFiberPort}`,
      port: react17UseFiberPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @bippy/e2e-use-fiber-versions build:18 && pnpm --filter @bippy/e2e-use-fiber-versions preview:18 --port ${react18UseFiberPort}`,
      port: react18UseFiberPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `nr --filter @bippy/e2e-profiling build && nr --filter @bippy/e2e-profiling preview --port ${profilingPort}`,
      port: profilingPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `nr --filter @bippy/e2e-script-tag prepare-vendor && nr --filter @bippy/e2e-script-tag preview --port ${scriptTagPort}`,
      port: scriptTagPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `nr --filter @bippy/e2e-kitchen-sink build && nr --filter @bippy/e2e-kitchen-sink preview --port ${kitchenSinkPort}`,
      port: kitchenSinkPort,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `nr --filter @bippy/e2e-stress build && nr --filter @bippy/e2e-stress preview --port ${stressProductionPort}`,
      port: stressProductionPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

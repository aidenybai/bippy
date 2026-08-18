import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const vitePort = Number(process.env.BIPPY_E2E_VITE_PORT ?? 5180);
const nextPort = Number(process.env.BIPPY_E2E_NEXT_PORT ?? 3100);
const tanstackPort = Number(process.env.BIPPY_E2E_TANSTACK_PORT ?? 3200);
const reactRouterPort = Number(process.env.BIPPY_E2E_REACT_ROUTER_PORT ?? 3300);
const remixPort = Number(process.env.BIPPY_E2E_REMIX_PORT ?? 3400);
const rsbuildPort = Number(process.env.BIPPY_E2E_RSBUILD_PORT ?? 3500);
const astroPort = Number(process.env.BIPPY_E2E_ASTRO_PORT ?? 3600);
const kitchenSinkPort = Number(process.env.BIPPY_E2E_KITCHEN_SINK_PORT ?? 5199);
const stressPort = Number(process.env.BIPPY_E2E_STRESS_PORT ?? 5198);
const refreshPort = Number(process.env.BIPPY_E2E_REFRESH_PORT ?? 5190);
const refreshReact18Port = Number(process.env.BIPPY_E2E_REFRESH_18_PORT ?? 5191);
const refreshReact17Port = Number(process.env.BIPPY_E2E_REFRESH_17_PORT ?? 5192);
const refreshExperimentalPort = Number(process.env.BIPPY_E2E_REFRESH_EXPERIMENTAL_PORT ?? 5193);
const chromeExtensionTestMatch = /chrome-extension\.spec\.ts/;
const refreshTestMatch = /refresh\/.*\.spec\.ts/;
// The late-load regression page exists in every refresh fixture.
const refreshReact19TestMatch = [/refresh\/react-fresh\.spec\.ts/, /refresh\/late-load\.spec\.ts/];
const refreshReact18TestMatch = [/refresh\/react-18\.spec\.ts/, /refresh\/late-load\.spec\.ts/];
const refreshReact17TestMatch = [/refresh\/react-17\.spec\.ts/, /refresh\/late-load\.spec\.ts/];
const refreshExperimentalTestMatch = [
  /refresh\/react-experimental\.spec\.ts/,
  /refresh\/late-load\.spec\.ts/,
];
const hmrTestMatch = /hmr\/.*\.spec\.ts/;
const kitchenSinkTestMatch = /kitchen-sink.*\.spec\.ts/;
const stressTestMatch = /stress\/.*\.spec\.ts/;
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
  kitchenSinkTestMatch,
  stressTestMatch,
  ...productionOnlyTestMatch,
];

interface NamedWebServer {
  name: string;
  command: string;
  port?: number;
  url?: string;
  reuseExistingServer: boolean;
  timeout: number;
}

// Playwright starts every configured webServer regardless of --project.
// BIPPY_E2E_SERVERS (comma-separated names matching the project names)
// limits startup to the servers a run actually needs, e.g. the
// react-canary workflow sets BIPPY_E2E_SERVERS=refresh-experimental.
const getRequestedWebServers = () => {
  const allWebServers: NamedWebServer[] = [
    {
      name: "vite",
      command: `pnpm --filter @bippy/e2e-vite dev --port ${vitePort}`,
      port: vitePort,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      name: "nextjs",
      command: `pnpm --filter @bippy/e2e-next dev --port ${nextPort}`,
      // Waiting on the URL (not just the port) lets webpack finish the slow
      // first compile of the page before tests start hitting it in parallel.
      url: `http://localhost:${nextPort}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      name: "tanstack",
      command: `pnpm --filter @bippy/e2e-tanstack dev --port ${tanstackPort}`,
      port: tanstackPort,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      name: "react-router",
      command: `pnpm --filter @bippy/e2e-react-router dev --port ${reactRouterPort}`,
      // Waiting on the URL lets the dev server finish the first compile.
      url: `http://localhost:${reactRouterPort}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      name: "remix",
      command: `pnpm --filter @bippy/e2e-remix dev --port ${remixPort}`,
      url: `http://localhost:${remixPort}`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      name: "rsbuild",
      command: `pnpm --filter @bippy/e2e-rsbuild dev --port ${rsbuildPort}`,
      port: rsbuildPort,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      name: "astro",
      command: `pnpm --filter @bippy/e2e-astro dev --port ${astroPort}`,
      port: astroPort,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      name: "kitchen-sink",
      command: `pnpm --filter @bippy/e2e-kitchen-sink dev --port ${kitchenSinkPort}`,
      port: kitchenSinkPort,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      name: "stress",
      command: `pnpm --filter @bippy/e2e-stress dev --port ${stressPort}`,
      port: stressPort,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      name: "refresh",
      command: `pnpm --filter @bippy/e2e-refresh dev --port ${refreshPort}`,
      port: refreshPort,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      name: "refresh-react18",
      command: `pnpm --filter @bippy/e2e-refresh-react18 dev --port ${refreshReact18Port}`,
      port: refreshReact18Port,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      name: "refresh-react17",
      command: `pnpm --filter @bippy/e2e-refresh-react17 dev --port ${refreshReact17Port}`,
      port: refreshReact17Port,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      name: "refresh-experimental",
      command: `pnpm --filter @bippy/e2e-refresh-experimental dev --port ${refreshExperimentalPort}`,
      port: refreshExperimentalPort,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
  ];

  const requestedServerNames = process.env.BIPPY_E2E_SERVERS?.split(",")
    .map((serverName) => serverName.trim())
    .filter(Boolean);
  const selectedWebServers = requestedServerNames
    ? allWebServers.filter((namedServer) => requestedServerNames.includes(namedServer.name))
    : allWebServers;
  if (requestedServerNames && selectedWebServers.length !== requestedServerNames.length) {
    const knownNames = allWebServers.map((namedServer) => namedServer.name);
    throw new Error(
      `BIPPY_E2E_SERVERS contains unknown server names; known names: ${knownNames.join(", ")}`,
    );
  }
  return selectedWebServers.map(({ name: _serverName, ...serverConfig }) => serverConfig);
};

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
      name: "react-router",
      testIgnore: sharedProjectTestIgnore,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${reactRouterPort}` },
    },
    {
      name: "remix",
      testIgnore: sharedProjectTestIgnore,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${remixPort}` },
    },
    {
      name: "rsbuild",
      testIgnore: sharedProjectTestIgnore,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${rsbuildPort}` },
    },
    {
      name: "astro",
      testIgnore: sharedProjectTestIgnore,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${astroPort}` },
    },
    {
      name: "kitchen-sink",
      testMatch: kitchenSinkTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${kitchenSinkPort}` },
    },
    {
      name: "stress",
      testMatch: stressTestMatch,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${stressPort}` },
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
      name: "refresh-experimental",
      testMatch: refreshExperimentalTestMatch,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${refreshExperimentalPort}`,
      },
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
  webServer: getRequestedWebServers(),
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/web",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "vite",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5180" },
    },
    {
      name: "nextjs",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3100" },
    },
    {
      name: "tanstack",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3200" },
    },
  ],
  webServer: [
    {
      command: "vp run @bippy/e2e-vite#dev --port 5180",
      port: 5180,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "vp run @bippy/e2e-next#dev --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "vp run @bippy/e2e-tanstack#dev --port 3200",
      port: 3200,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

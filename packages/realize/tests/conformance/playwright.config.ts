import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "repos",
  testMatch: "*/verify/*.spec.ts",
  timeout: 120_000,
  fullyParallel: false,
  reporter: "list",
});

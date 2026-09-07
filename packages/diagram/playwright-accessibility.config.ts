import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig(config, {
  testMatch: ["**/accessibility*.spec.ts", "**/slots.spec.ts"],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});

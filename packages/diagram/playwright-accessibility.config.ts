import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig(config, {
  testMatch: [
    "**/accessibility*.spec.ts",
    "**/slots.spec.ts",
    "**/tree-controls.spec.ts",
    "**/function-symbol.spec.ts",
    "**/board-shell.spec.ts",
    "**/theme-parity.spec.ts",
    "**/tree-overlap.spec.ts",
    "**/live-inspector.spec.ts",
  ],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});

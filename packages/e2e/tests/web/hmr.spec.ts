import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { waitForTestChild } from "./helpers";

declare global {
  interface Window {
    __BIPPY_HMR__?: {
      updates: string[][];
      hasTransport: boolean | null;
    };
  }
}

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(SPEC_DIR, "../../fixtures");

const HMR_TARGET_FILE_BY_PROJECT: Record<string, string> = {
  vite: path.join(FIXTURES_DIR, "vite-app/src/hmr-target.tsx"),
  nextjs: path.join(FIXTURES_DIR, "next-app/app/hmr-target.tsx"),
  tanstack: path.join(FIXTURES_DIR, "tanstack-app/src/hmr-target.tsx"),
};

const HMR_UPDATE_TIMEOUT_MS = 15_000;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
});

test.describe("bippy/react-refresh", () => {
  test("detects an hmr transport for the dev server", async ({ page }) => {
    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasTransport === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });
  });

  test("receives updated file paths when a source file is saved", async ({ page }) => {
    const targetFilePath = HMR_TARGET_FILE_BY_PROJECT[test.info().project.name];
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = originalSource.includes("hmr-marker-a") ? "hmr-marker-a" : "hmr-marker-b";
    const nextMarker = currentMarker === "hmr-marker-a" ? "hmr-marker-b" : "hmr-marker-a";

    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasTransport === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });

    try {
      writeFileSync(targetFilePath, originalSource.replace(currentMarker, nextMarker));

      await page.waitForFunction(
        () =>
          window.__BIPPY_HMR__ !== undefined &&
          window.__BIPPY_HMR__.updates.flat().some((filePath) => filePath.includes("hmr-target")),
        undefined,
        { timeout: HMR_UPDATE_TIMEOUT_MS },
      );

      await expect(page.getByTestId("hmr-target")).toHaveText(nextMarker, {
        timeout: HMR_UPDATE_TIMEOUT_MS,
      });
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });
});

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { waitForTestChild } from "./helpers";

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

  test("reports each update in a sequence of consecutive saves", async ({ page }) => {
    const targetFilePath = HMR_TARGET_FILE_BY_PROJECT[test.info().project.name];
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = originalSource.includes("hmr-marker-a") ? "hmr-marker-a" : "hmr-marker-b";
    const nextMarker = currentMarker === "hmr-marker-a" ? "hmr-marker-b" : "hmr-marker-a";

    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasTransport === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });

    const countTargetUpdates = () =>
      page.evaluate(
        () =>
          window.__BIPPY_HMR__?.updates.flat().filter((filePath) => filePath.includes("hmr-target"))
            .length ?? 0,
      );
    const initialUpdateCount = await countTargetUpdates();

    try {
      writeFileSync(targetFilePath, originalSource.replace(currentMarker, nextMarker));
      await expect(page.getByTestId("hmr-target")).toHaveText(nextMarker, {
        timeout: HMR_UPDATE_TIMEOUT_MS,
      });
      const updateCountAfterFirstSave = await countTargetUpdates();
      expect(updateCountAfterFirstSave).toBeGreaterThan(initialUpdateCount);

      writeFileSync(targetFilePath, originalSource);
      await expect(page.getByTestId("hmr-target")).toHaveText(currentMarker, {
        timeout: HMR_UPDATE_TIMEOUT_MS,
      });
      const updateCountAfterSecondSave = await countTargetUpdates();
      expect(updateCountAfterSecondSave).toBeGreaterThan(updateCountAfterFirstSave);
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });

  test("css-only updates swap styles without reporting js update paths", async ({ page }) => {
    test.skip(
      test.info().project.name !== "vite",
      "the css hmr fixture only exists in the vite app",
    );
    const cssFilePath = path.join(FIXTURES_DIR, "vite-app/src/hmr-styles.css");
    const originalCss = readFileSync(cssFilePath, "utf8");

    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasTransport === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });
    await expect(page.getByTestId("hmr-target")).toHaveCSS("color", "rgb(10, 20, 30)");

    try {
      writeFileSync(cssFilePath, originalCss.replace("rgb(10, 20, 30)", "rgb(200, 30, 40)"));
      await expect(page.getByTestId("hmr-target")).toHaveCSS("color", "rgb(200, 30, 40)", {
        timeout: HMR_UPDATE_TIMEOUT_MS,
      });

      const cssUpdatePaths = await page.evaluate(() =>
        window.__BIPPY_HMR__!.updates.flat().filter((filePath) => filePath.includes("hmr-styles")),
      );
      expect(cssUpdatePaths).toEqual([]);
    } finally {
      writeFileSync(cssFilePath, originalCss);
    }
  });
});

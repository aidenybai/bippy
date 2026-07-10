import { readFileSync, writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  buildUniqueMarker,
  countRefreshUpdatesMatching,
  HMR_UPDATE_TIMEOUT_MS,
  readCurrentMarker,
  resolveFixtureFile,
  SAVE_ATTEMPT_TIMEOUT_MS,
  SAVE_ATTEMPTS,
  saveAndAwaitText,
  waitForRefreshListener,
  waitForRefreshUpdateMatching,
} from "./hmr-helpers";
import { waitForTestChild } from "./helpers";

const HMR_MARKER_PREFIX = "hmr-marker";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForRefreshListener(page);
});

test.describe("bippy/react-refresh", () => {
  test("installs a refresh listener through the devtools hook", async ({ page }) => {
    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasRefreshListener === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });
  });

  test("reports the updated component when a source file is saved", async ({ page }) => {
    const targetFilePath = resolveFixtureFile(test.info().project.name, "hmr-target.tsx");
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource, HMR_MARKER_PREFIX);
    const uniqueMarker = buildUniqueMarker(HMR_MARKER_PREFIX);

    try {
      await saveAndAwaitText(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, uniqueMarker),
        "hmr-target",
        uniqueMarker,
      );

      await waitForRefreshUpdateMatching(page, { updatedName: "HmrTarget" });
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });

  test("collects the mounted fibers for hot-swapped component types", async ({ page }) => {
    const targetFilePath = resolveFixtureFile(test.info().project.name, "hmr-target.tsx");
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource, HMR_MARKER_PREFIX);
    const uniqueMarker = buildUniqueMarker(HMR_MARKER_PREFIX);

    try {
      await saveAndAwaitText(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, uniqueMarker),
        "hmr-target",
        uniqueMarker,
      );

      await waitForRefreshUpdateMatching(page, { updatedFiberName: "HmrTarget" });
      const validUpdateCount = await page.evaluate(
        () =>
          window.__BIPPY_HMR__?.refreshUpdates.filter(
            (refreshUpdate) =>
              refreshUpdate.updatedFiberNames.includes("HmrTarget") &&
              refreshUpdate.areUpdatedFibersValid,
          ).length ?? 0,
      );
      expect(validUpdateCount).toBeGreaterThan(0);
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });

  test("resolves source locations for the hot-swapped fibers", async ({ page }) => {
    const targetFilePath = resolveFixtureFile(test.info().project.name, "hmr-target.tsx");
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource, HMR_MARKER_PREFIX);
    const uniqueMarker = buildUniqueMarker(HMR_MARKER_PREFIX);

    try {
      await saveAndAwaitText(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, uniqueMarker),
        "hmr-target",
        uniqueMarker,
      );

      // getSource symbolicates asynchronously, so the harness backfills
      // updatedSourceFileNames on the record after the refresh update lands
      await page.waitForFunction(
        () =>
          window.__BIPPY_HMR__ !== undefined &&
          window.__BIPPY_HMR__.refreshUpdates.some(
            (refreshUpdate) =>
              refreshUpdate.updatedFiberNames.includes("HmrTarget") &&
              refreshUpdate.updatedSourceFileNames.some(
                (sourceFileName) => sourceFileName !== null && /\.[jt]sx?/.test(sourceFileName),
              ),
          ),
        undefined,
        { timeout: HMR_UPDATE_TIMEOUT_MS },
      );
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });

  test("augments refresh updates with the hot-updated file paths", async ({ page }) => {
    const targetFilePath = resolveFixtureFile(test.info().project.name, "hmr-target.tsx");
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource, HMR_MARKER_PREFIX);

    try {
      // the transport websocket connects asynchronously after page load, so
      // the first save can legitimately refresh with empty filePaths;
      // re-save with fresh markers until a refresh carries the path
      for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
        const uniqueMarker = buildUniqueMarker(HMR_MARKER_PREFIX);
        await saveAndAwaitText(
          page,
          targetFilePath,
          originalSource.replace(currentMarker, uniqueMarker),
          "hmr-target",
          uniqueMarker,
        );
        try {
          await waitForRefreshUpdateMatching(
            page,
            { filePathIncludes: "hmr-target", updatedName: "HmrTarget" },
            SAVE_ATTEMPT_TIMEOUT_MS,
          );
          break;
        } catch (waitError) {
          if (attempt === SAVE_ATTEMPTS) throw waitError;
        }
      }
      expect(
        await countRefreshUpdatesMatching(page, {
          filePathIncludes: "hmr-target",
          updatedName: "HmrTarget",
        }),
      ).toBeGreaterThan(0);
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });

  test("reports each update in a sequence of consecutive saves", async ({ page }) => {
    const targetFilePath = resolveFixtureFile(test.info().project.name, "hmr-target.tsx");
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource, HMR_MARKER_PREFIX);
    const firstUniqueMarker = buildUniqueMarker(HMR_MARKER_PREFIX);
    const secondUniqueMarker = buildUniqueMarker(HMR_MARKER_PREFIX);

    const initialUpdateCount = await countRefreshUpdatesMatching(page, {
      updatedName: "HmrTarget",
    });

    try {
      await saveAndAwaitText(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, firstUniqueMarker),
        "hmr-target",
        firstUniqueMarker,
      );
      const updateCountAfterFirstSave = await countRefreshUpdatesMatching(page, {
        updatedName: "HmrTarget",
      });
      expect(updateCountAfterFirstSave).toBeGreaterThan(initialUpdateCount);

      await saveAndAwaitText(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, secondUniqueMarker),
        "hmr-target",
        secondUniqueMarker,
      );
      const updateCountAfterSecondSave = await countRefreshUpdatesMatching(page, {
        updatedName: "HmrTarget",
      });
      expect(updateCountAfterSecondSave).toBeGreaterThan(updateCountAfterFirstSave);
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });
});

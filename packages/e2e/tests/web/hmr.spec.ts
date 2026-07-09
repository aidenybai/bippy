import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { waitForTestChild } from "./helpers";

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(SPEC_DIR, "../../fixtures");

const HMR_TARGET_FILE_BY_PROJECT: Record<string, string> = {
  vite: path.join(FIXTURES_DIR, "vite-app/src/hmr-target.tsx"),
  nextjs: path.join(FIXTURES_DIR, "next-app/app/hmr-target.tsx"),
  tanstack: path.join(FIXTURES_DIR, "tanstack-app/src/hmr-target.tsx"),
};

const HMR_UPDATE_TIMEOUT_MS = 15_000;

// each save writes a fresh unique marker (instead of toggling between two
// fixed values) so an assertion can never be satisfied by stale DOM state
// left over from a previous test's restore write still applying
const HMR_MARKER_REGEX = /hmr-marker-[\w-]+/;

const readCurrentMarker = (source: string): string => {
  const markerMatch = source.match(HMR_MARKER_REGEX);
  if (!markerMatch) throw new Error("hmr-target fixture is missing an hmr-marker");
  return markerMatch[0];
};

let uniqueMarkerCounter = 0;
const buildUniqueMarker = (): string => `hmr-marker-${Date.now()}-${uniqueMarkerCounter++}`;

const SAVE_ATTEMPTS = 3;
const SAVE_ATTEMPT_TIMEOUT_MS = 5_000;

// a save landing milliseconds after the previous hot update can be coalesced
// away by the dev server's file watcher on slow CI machines, so re-save until
// the update propagates, like an editor save would
const saveAndAwaitMarker = async (
  page: Page,
  targetFilePath: string,
  nextSource: string,
  expectedMarker: string,
) => {
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
    writeFileSync(targetFilePath, nextSource);
    try {
      await expect(page.getByTestId("hmr-target")).toHaveText(expectedMarker, {
        timeout: SAVE_ATTEMPT_TIMEOUT_MS,
      });
      return;
    } catch (saveError) {
      if (attempt === SAVE_ATTEMPTS) throw saveError;
    }
  }
};

const countHmrTargetRefreshUpdates = (page: Page) =>
  page.evaluate(
    () =>
      window.__BIPPY_HMR__?.refreshUpdates.filter((refreshUpdate) =>
        refreshUpdate.updatedNames.includes("HmrTarget"),
      ).length ?? 0,
  );

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
});

test.describe("bippy/react-refresh", () => {
  test("installs a refresh listener through the devtools hook", async ({ page }) => {
    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasRefreshListener === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });
  });

  test("reports the updated component when a source file is saved", async ({ page }) => {
    const targetFilePath = HMR_TARGET_FILE_BY_PROJECT[test.info().project.name];
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource);
    const uniqueMarker = buildUniqueMarker();

    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasRefreshListener === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });

    try {
      await saveAndAwaitMarker(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, uniqueMarker),
        uniqueMarker,
      );

      await page.waitForFunction(
        () =>
          window.__BIPPY_HMR__ !== undefined &&
          window.__BIPPY_HMR__.refreshUpdates.some((refreshUpdate) =>
            refreshUpdate.updatedNames.includes("HmrTarget"),
          ),
        undefined,
        { timeout: HMR_UPDATE_TIMEOUT_MS },
      );
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });

  test("collects the mounted fibers for hot-swapped component types", async ({ page }) => {
    const targetFilePath = HMR_TARGET_FILE_BY_PROJECT[test.info().project.name];
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource);
    const uniqueMarker = buildUniqueMarker();

    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasRefreshListener === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });

    try {
      await saveAndAwaitMarker(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, uniqueMarker),
        uniqueMarker,
      );

      await page.waitForFunction(
        () =>
          window.__BIPPY_HMR__ !== undefined &&
          window.__BIPPY_HMR__.refreshUpdates.some(
            (refreshUpdate) =>
              refreshUpdate.updatedFiberNames.includes("HmrTarget") &&
              refreshUpdate.areUpdatedFibersValid,
          ),
        undefined,
        { timeout: HMR_UPDATE_TIMEOUT_MS },
      );
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });

  test("resolves source locations for the hot-swapped fibers", async ({ page }) => {
    const targetFilePath = HMR_TARGET_FILE_BY_PROJECT[test.info().project.name];
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource);
    const uniqueMarker = buildUniqueMarker();

    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasRefreshListener === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });

    try {
      await saveAndAwaitMarker(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, uniqueMarker),
        uniqueMarker,
      );

      // getSources symbolicates asynchronously, so the harness backfills
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
    const targetFilePath = HMR_TARGET_FILE_BY_PROJECT[test.info().project.name];
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource);

    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasRefreshListener === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });

    const hasRefreshUpdateWithTargetFilePath = () =>
      page.evaluate(
        () =>
          window.__BIPPY_HMR__?.refreshUpdates.some(
            (refreshUpdate) =>
              refreshUpdate.updatedNames.includes("HmrTarget") &&
              refreshUpdate.filePaths.some((filePath) => filePath.includes("hmr-target")),
          ) ?? false,
      );

    try {
      // the transport websocket connects asynchronously after page load, so
      // the first save can legitimately refresh with empty filePaths;
      // re-save with fresh markers until a refresh carries the path
      for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
        const uniqueMarker = buildUniqueMarker();
        await saveAndAwaitMarker(
          page,
          targetFilePath,
          originalSource.replace(currentMarker, uniqueMarker),
          uniqueMarker,
        );
        try {
          await page.waitForFunction(
            () =>
              window.__BIPPY_HMR__ !== undefined &&
              window.__BIPPY_HMR__.refreshUpdates.some(
                (refreshUpdate) =>
                  refreshUpdate.updatedNames.includes("HmrTarget") &&
                  refreshUpdate.filePaths.some((filePath) => filePath.includes("hmr-target")),
              ),
            undefined,
            { timeout: SAVE_ATTEMPT_TIMEOUT_MS },
          );
          break;
        } catch (waitError) {
          if (attempt === SAVE_ATTEMPTS) throw waitError;
        }
      }
      expect(await hasRefreshUpdateWithTargetFilePath()).toBe(true);
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });

  test("reports each update in a sequence of consecutive saves", async ({ page }) => {
    const targetFilePath = HMR_TARGET_FILE_BY_PROJECT[test.info().project.name];
    const originalSource = readFileSync(targetFilePath, "utf8");
    const currentMarker = readCurrentMarker(originalSource);
    const firstUniqueMarker = buildUniqueMarker();
    const secondUniqueMarker = buildUniqueMarker();

    await page.waitForFunction(() => window.__BIPPY_HMR__?.hasRefreshListener === true, undefined, {
      timeout: HMR_UPDATE_TIMEOUT_MS,
    });

    const initialUpdateCount = await countHmrTargetRefreshUpdates(page);

    try {
      await saveAndAwaitMarker(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, firstUniqueMarker),
        firstUniqueMarker,
      );
      const updateCountAfterFirstSave = await countHmrTargetRefreshUpdates(page);
      expect(updateCountAfterFirstSave).toBeGreaterThan(initialUpdateCount);

      await saveAndAwaitMarker(
        page,
        targetFilePath,
        originalSource.replace(currentMarker, secondUniqueMarker),
        secondUniqueMarker,
      );
      const updateCountAfterSecondSave = await countHmrTargetRefreshUpdates(page);
      expect(updateCountAfterSecondSave).toBeGreaterThan(updateCountAfterFirstSave);
    } finally {
      writeFileSync(targetFilePath, originalSource);
    }
  });
});

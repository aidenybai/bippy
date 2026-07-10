import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(HELPERS_DIR, "../../fixtures");

const FIXTURE_SOURCE_DIR_BY_PROJECT: Record<string, string> = {
  nextjs: "next-app/app",
  tanstack: "tanstack-app/src",
  vite: "vite-app/src",
};

export const resolveFixtureFile = (projectName: string, fileName: string): string =>
  path.join(FIXTURES_DIR, FIXTURE_SOURCE_DIR_BY_PROJECT[projectName], fileName);

export const HMR_UPDATE_TIMEOUT_MS = 15_000;
export const SAVE_ATTEMPTS = 3;
export const SAVE_ATTEMPT_TIMEOUT_MS = 5_000;

// each save writes a fresh unique marker (instead of toggling between two
// fixed values) so an assertion can never be satisfied by stale DOM state
// left over from a previous test's restore write still applying
let uniqueMarkerSuffixCounter = 0;
export const buildUniqueMarker = (markerPrefix: string): string =>
  `${markerPrefix}-${Date.now()}-${uniqueMarkerSuffixCounter++}`;

export const readCurrentMarker = (source: string, markerPrefix: string): string => {
  const markerMatch = source.match(new RegExp(`${markerPrefix}-[\\w-]+`));
  if (!markerMatch) throw new Error(`fixture is missing a ${markerPrefix} marker`);
  return markerMatch[0];
};

// a save landing milliseconds after the previous hot update can be coalesced
// away by the dev server's file watcher on slow CI machines, so re-save until
// the update propagates, like an editor save would
export const saveAndAwaitText = async (
  page: Page,
  targetFilePath: string,
  nextSource: string,
  testId: string,
  expectedText: string,
) => {
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
    writeFileSync(targetFilePath, nextSource);
    try {
      await expect(page.getByTestId(testId)).toContainText(expectedText, {
        timeout: SAVE_ATTEMPT_TIMEOUT_MS,
      });
      return;
    } catch (saveError) {
      if (attempt === SAVE_ATTEMPTS) throw saveError;
    }
  }
};

export const waitForRefreshListener = async (page: Page) => {
  await page.waitForFunction(() => window.__BIPPY_HMR__?.hasRefreshListener === true, undefined, {
    timeout: HMR_UPDATE_TIMEOUT_MS,
  });
};

export interface RefreshUpdateCriteria {
  filePathIncludes?: string;
  staleFiberName?: string;
  staleName?: string;
  updatedFiberName?: string;
  updatedFiberNameCount?: number;
  updatedName?: string;
  withoutUpdatedFiberName?: string;
}

export const countRefreshUpdatesMatching = (page: Page, criteria: RefreshUpdateCriteria) =>
  page.evaluate((matchCriteria) => {
    if (!window.__BIPPY_HMR__) return 0;
    return window.__BIPPY_HMR__.refreshUpdates.filter((refreshUpdate) => {
      if (
        matchCriteria.updatedName !== undefined &&
        !refreshUpdate.updatedNames.includes(matchCriteria.updatedName)
      ) {
        return false;
      }
      if (
        matchCriteria.updatedFiberName !== undefined &&
        !refreshUpdate.updatedFiberNames.includes(matchCriteria.updatedFiberName)
      ) {
        return false;
      }
      if (
        matchCriteria.updatedFiberNameCount !== undefined &&
        matchCriteria.updatedFiberName !== undefined &&
        refreshUpdate.updatedFiberNames.filter(
          (fiberName) => fiberName === matchCriteria.updatedFiberName,
        ).length !== matchCriteria.updatedFiberNameCount
      ) {
        return false;
      }
      if (
        matchCriteria.withoutUpdatedFiberName !== undefined &&
        refreshUpdate.updatedFiberNames.includes(matchCriteria.withoutUpdatedFiberName)
      ) {
        return false;
      }
      if (
        matchCriteria.staleName !== undefined &&
        !refreshUpdate.staleNames.includes(matchCriteria.staleName)
      ) {
        return false;
      }
      if (
        matchCriteria.staleFiberName !== undefined &&
        !refreshUpdate.staleFiberNames.includes(matchCriteria.staleFiberName)
      ) {
        return false;
      }
      if (
        matchCriteria.filePathIncludes !== undefined &&
        !refreshUpdate.filePaths.some((filePath) =>
          filePath.includes(matchCriteria.filePathIncludes as string),
        )
      ) {
        return false;
      }
      return true;
    }).length;
  }, criteria);

export const waitForRefreshUpdateMatching = async (
  page: Page,
  criteria: RefreshUpdateCriteria,
  timeoutMs: number = HMR_UPDATE_TIMEOUT_MS,
) => {
  await expect
    .poll(() => countRefreshUpdatesMatching(page, criteria), { timeout: timeoutMs })
    .toBeGreaterThan(0);
};

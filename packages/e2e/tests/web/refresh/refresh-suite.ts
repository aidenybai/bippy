// Shared driver for the ported ReactFresh suite: each project points its
// baseURL at a fixture serving the same harness against a different React
// major, and this declares one test per applicable scenario.
import { expect, test, type Page } from "@playwright/test";

import {
  getScenarioNamesForReactMajor,
  scenarioManifest,
} from "../../../fixtures/refresh-app/src/scenario-manifest";

const STRESS_SCENARIO = "keeps a valid tree when forcing remount";

const waitForHarness = async (page: Page): Promise<void> => {
  await page.goto("/");
  await page.waitForFunction(() => window.__HARNESS_READY__ === true, undefined, {
    timeout: 15_000,
  });
};

export const defineRefreshSuite = (reactMajor: number): void => {
  const applicableNames = getScenarioNamesForReactMajor(reactMajor);
  const applicableDescriptors = scenarioManifest.filter((descriptor) =>
    applicableNames.includes(descriptor.name),
  );

  test.describe(`ReactFresh (ported from facebook/react) on React ${reactMajor}`, () => {
    test("scenario registry matches the manifest", async ({ page }) => {
      await waitForHarness(page);
      const registeredNames = await page.evaluate(() => window.__SCENARIO_NAMES__);
      expect(registeredNames.sort()).toEqual([...applicableNames].sort());
    });

    for (const descriptor of applicableDescriptors) {
      test(descriptor.name, async ({ page }) => {
        const knownIssueApplies =
          descriptor.knownIssue !== undefined &&
          (descriptor.knownIssueReactMajors?.includes(reactMajor) ?? true);
        if (knownIssueApplies) {
          // Documented divergence between published react packages and
          // React main; flips to "unexpected pass" once the fix ships.
          test.fail(true, descriptor.knownIssue);
        }
        if (descriptor.name === STRESS_SCENARIO) {
          // The remounting stress test exercises 169 tree pairings.
          test.setTimeout(300_000);
        }
        await waitForHarness(page);
        const result = await page.evaluate(
          (scenarioName) => window.__RUN_SCENARIO__(scenarioName),
          descriptor.name,
        );
        expect(result.status, result.error).toBe("passed");
      });
    }
  });
};

// Drives the browser port of facebook/react's ReactFresh-test.js suite
// (see fixtures/refresh-app/src/scenarios). Every scenario runs on a fresh
// page so react-refresh runtime state never leaks between tests, against a
// real react-dom dev build with bippy installed before React.
import { expect, test } from "@playwright/test";

import { scenarioManifest } from "../../../fixtures/refresh-app/src/scenario-manifest";

const STRESS_SCENARIO = "keeps a valid tree when forcing remount";

const waitForHarness = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__HARNESS_READY__ === true, undefined, {
    timeout: 15_000,
  });
};

test.describe("ReactFresh (ported from facebook/react)", () => {
  test("scenario registry matches the manifest", async ({ page }) => {
    await waitForHarness(page);
    const registeredNames = await page.evaluate(() => window.__SCENARIO_NAMES__);
    expect(registeredNames.sort()).toEqual(
      scenarioManifest.map((descriptor) => descriptor.name).sort(),
    );
  });

  for (const descriptor of scenarioManifest) {
    test(descriptor.name, async ({ page }) => {
      if (descriptor.knownIssue) {
        // Documented divergence between published react packages and React
        // main; flips to "unexpected pass" once the upstream fix ships.
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

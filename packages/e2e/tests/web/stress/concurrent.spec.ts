// Concurrent React under bippy: interrupted/restarted transition renders,
// use()-driven Suspense resolution cycles, and root mount/unmount churn
// that guards root tracking against leaks (the #97 family).
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/concurrent.html");
  await page.waitForFunction(() => window.__HARNESS_READY__ === true, undefined, {
    timeout: 15_000,
  });
});

test("interleaved transitions settle correctly with bippy observing every commit", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const result = await page.evaluate(() => window.__CONCURRENT__.runTransitionStress(40));
  expect(result.isPendingSettled).toBe(true);
  expect(result.finalQuery.length).toBeGreaterThan(0);
  // The deferred list settled on exactly the final query's matches, so no
  // interrupted render leaked stale output.
  expect(result.renderedMatches).toBe(result.expectedMatches);
  // Far fewer commits than updates: interrupted renders never committed,
  // and bippy observed only real commits without breaking.
  expect(result.commitCount).toBeGreaterThan(2);
});

test("use()-driven Suspense cycles resolve with commits observed", async ({ page }) => {
  test.setTimeout(60_000);
  const result = await page.evaluate(() => window.__CONCURRENT__.runSuspenseCycles(10));
  expect(result.resolvedCycles).toBe(10);
  expect(result.commitCount).toBeGreaterThanOrEqual(10);
});

test("root churn: unmounted roots leave bippy's tracking and instrumentation survives", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const result = await page.evaluate(() => window.__CONCURRENT__.runRootChurn(25));
  expect(result.fiberRootCountWhileMounted).toBeGreaterThanOrEqual(
    result.fiberRootCountBaseline + 25,
  );
  // Unmounted roots must not leak in _fiberRoots (root commit tracking).
  expect(result.fiberRootCountAfterUnmount).toBe(result.fiberRootCountBaseline);
  expect(result.instrumentationStillActive).toBe(true);
});

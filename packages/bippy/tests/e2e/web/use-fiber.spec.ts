import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { waitForBippy, waitForTestChild } from "./helpers";

const expectFiberMatch = async (page: Page, testId: string) => {
  await expect(page.getByTestId(testId)).toHaveAttribute("data-fiber-match", "true");
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForBippy(page);
  await waitForTestChild(page);
});

test("runs version fixtures against the expected React production line", async ({
  page,
}, testInfo) => {
  const isReact17 = testInfo.project.name.startsWith("react-17");
  const isReact18 = testInfo.project.name.startsWith("react-18");
  testInfo.skip(!isReact17 && !isReact18);
  await expect(page.getByTestId("test-child")).toContainText(isReact17 ? "17." : "18.");
});

test("server rendering returns undefined without breaking FiberProvider checks", async ({
  page,
}, testInfo) => {
  const serverRenderedProjects = [
    "nextjs-production",
    "tanstack-production",
    "react-router-production",
    "remix-production",
    "astro-production",
  ];
  testInfo.skip(!serverRenderedProjects.includes(testInfo.project.name));
  const response = await page.request.get("/");
  const markup = await response.text();
  expect(markup).toContain('data-testid="use-fiber-render-phase"');
  expect(markup).not.toContain('data-fiber-match="false"');
});

test("useFiber matches an independent FiberProvider across repeated updates", async ({ page }) => {
  expect(await page.evaluate(() => window.__USE_FIBER_MATCH__)).toBe(true);

  const updateButton = page.getByTestId("use-fiber-update");
  for (let revision = 1; revision <= 10; revision += 1) {
    await updateButton.click();
    await expect(updateButton).toHaveText(String(revision));
    expect(await page.evaluate(() => window.__USE_FIBER_MATCH__)).toBe(true);
  }
});

test("useFiber matches for sibling, forward ref, memo, and render-phase components", async ({
  page,
}) => {
  for (const testId of [
    "use-fiber-sibling-1",
    "use-fiber-sibling-2",
    "use-fiber-hook-order",
    "use-fiber-forward-ref",
    "use-fiber-memo",
    "use-fiber-render-phase",
    "use-fiber-commit-phase",
    "use-fiber-batched-update",
    "use-fiber-remount-result",
    "use-fiber-transition",
    "use-fiber-portal",
  ]) {
    await expectFiberMatch(page, testId);
  }
});

test("useFiber matches after batched, memo, remount, and transition updates", async ({ page }) => {
  const hookOrderButton = page.getByTestId("use-fiber-hook-order");
  const batchedUpdateButton = page.getByTestId("use-fiber-batched-update");
  const memoButton = page.getByTestId("use-fiber-memo-update");
  const remountButton = page.getByTestId("use-fiber-remount");
  const transitionButton = page.getByTestId("use-fiber-transition");

  await expect(page.getByTestId("use-fiber-commit-phase")).toHaveText("1");
  await expectFiberMatch(page, "use-fiber-commit-phase");

  for (let revision = 1; revision <= 5; revision += 1) {
    await hookOrderButton.click();
    await expect(hookOrderButton).toHaveText(String(revision));
    await expectFiberMatch(page, "use-fiber-hook-order");

    await batchedUpdateButton.click();
    await expect(batchedUpdateButton).toHaveText(String(revision * 2));
    await expectFiberMatch(page, "use-fiber-batched-update");

    await memoButton.click();
    await expect(page.getByTestId("use-fiber-memo")).toHaveText(String(revision));
    await expectFiberMatch(page, "use-fiber-memo");

    await remountButton.click();
    await expect(page.getByTestId("use-fiber-remount-result")).toHaveText(String(revision));
    await expectFiberMatch(page, "use-fiber-remount-result");

    await transitionButton.click();
    await expect(transitionButton).toHaveText(String(revision));
    await expectFiberMatch(page, "use-fiber-transition");
  }
});

test("useFiber matches renders that suspend and retry", async ({ page }) => {
  await page.getByTestId("use-fiber-suspense-show").click();
  await expectFiberMatch(page, "use-fiber-suspense-fallback");

  await page.getByTestId("use-fiber-suspense-resolve").click();
  await expectFiberMatch(page, "use-fiber-suspense-result");
});

test("useFiber matches lazy components after Suspense resolution", async ({ page }) => {
  await page.getByTestId("use-fiber-lazy-show").click();
  await expect(page.getByTestId("use-fiber-lazy-fallback")).toBeVisible();

  await page.getByTestId("use-fiber-lazy-resolve").click();
  await expectFiberMatch(page, "use-fiber-lazy-result");
});

test("useFiber matches fibers from failed renders", async ({ page }) => {
  await page.getByTestId("use-fiber-error-show").click();
  await expectFiberMatch(page, "use-fiber-error-result");
});

import { expect, test } from "@playwright/test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForBippy(page);
  await waitForTestChild(page);
});

test("useFiber returns the exact calling fiber", async ({ page }) => {
  const mountedResult = await page.evaluate(() => {
    const parentElement = document.querySelector('[data-testid="parent-host"]');
    if (!parentElement) throw new Error("parent host element not found");
    const observedFiber = window.__USE_FIBER__
      ? window.__BIPPY__.getLatestFiber(window.__USE_FIBER__)
      : null;
    const hostFiber = window.__BIPPY__.getFiberFromHostInstance(parentElement);
    let rootFiber = hostFiber ? window.__BIPPY__.getLatestFiber(hostFiber) : null;
    while (rootFiber?.return) rootFiber = rootFiber.return;
    if (rootFiber) rootFiber = window.__BIPPY__.getLatestFiber(rootFiber);
    const matchedFiber = window.__BIPPY__.traverseFiber(
      rootFiber,
      (candidateFiber) => candidateFiber === observedFiber,
    );
    return {
      capturedExactFiber: observedFiber === matchedFiber,
    };
  });

  expect(mountedResult.capturedExactFiber).toBe(true);

  await page.getByTestId("use-fiber-update").click();
  await expect(page.getByTestId("use-fiber-update")).toHaveText("1");

  const updatedResult = await page.evaluate(() => {
    const parentElement = document.querySelector('[data-testid="parent-host"]');
    if (!parentElement) throw new Error("parent host element not found");
    const observedFiber = window.__USE_FIBER__
      ? window.__BIPPY__.getLatestFiber(window.__USE_FIBER__)
      : null;
    const hostFiber = window.__BIPPY__.getFiberFromHostInstance(parentElement);
    let rootFiber = hostFiber ? window.__BIPPY__.getLatestFiber(hostFiber) : null;
    while (rootFiber?.return) rootFiber = rootFiber.return;
    if (rootFiber) rootFiber = window.__BIPPY__.getLatestFiber(rootFiber);
    const matchedFiber = window.__BIPPY__.traverseFiber(
      rootFiber,
      (candidateFiber) => candidateFiber === observedFiber,
    );
    return {
      capturedExactFiber: observedFiber === matchedFiber,
    };
  });

  expect(updatedResult).toEqual({ capturedExactFiber: true });
});

import { expect, test } from "./coverage-test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("overrideProps", () => {
  test("rewrites a prop and the DOM re-renders with the new value", async ({ page }) => {
    await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let childFiber = hostFiber?.return ?? null;
      while (childFiber && window.__BIPPY__.getDisplayName(childFiber.type) !== "TestChild") {
        childFiber = childFiber.return;
      }
      if (!childFiber) throw new Error("TestChild fiber not found");
      window.__BIPPY__.overrideProps(childFiber, { count: 42 });
    });
    await expect(page.getByTestId("test-child")).toHaveText("e2e-test 42");
  });
});

test.describe("overrideHookState", () => {
  test("rewrites useState state and dependent children re-render", async ({ page }) => {
    await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let parentFiber = hostFiber?.return ?? null;
      while (parentFiber && window.__BIPPY__.getDisplayName(parentFiber.type) !== "TestParent") {
        parentFiber = parentFiber.return;
      }
      if (!parentFiber) throw new Error("TestParent fiber not found");
      // the DOM-keyed fiber can be the stale half of the double buffer on
      // hydrated fixtures; hook 0 is TestParent's `count` useState
      window.__BIPPY__.overrideHookState(window.__BIPPY__.getLatestFiber(parentFiber), 0, 7);
    });
    await expect(page.getByTestId("test-child")).toHaveText("e2e-test 7");
  });
});

test.describe("overrideContext", () => {
  test("rewrites a provider value and the consumer re-renders", async ({ page }) => {
    // traverseContexts (used to grab the context object) needs an alternate
    // fiber, which only exists after the consumer has re-rendered once
    await page.click('[data-testid="increment"]');
    await expect(page.getByTestId("test-child")).toHaveText("e2e-test 1");

    await page.evaluate(() => {
      const element = document.querySelector('[data-testid="context-consumer"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let consumerFiber = hostFiber?.return ?? null;
      while (consumerFiber && !window.__BIPPY__.isCompositeFiber(consumerFiber)) {
        consumerFiber = consumerFiber.return;
      }
      if (!consumerFiber) throw new Error("consumer fiber not found");

      let contextType: unknown = null;
      window.__BIPPY__.traverseContexts(consumerFiber, (nextContext) => {
        if (nextContext) {
          contextType = nextContext.context;
          return true;
        }
      });
      if (!contextType) throw new Error("context dependency not found");

      window.__BIPPY__.overrideContext(consumerFiber, contextType, "overridden-value");
    });
    await expect(page.getByTestId("context-consumer")).toHaveText("overridden-value");
  });
});

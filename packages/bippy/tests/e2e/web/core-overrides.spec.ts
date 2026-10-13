import { expect, test } from "./coverage-test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("renderer capabilities", () => {
  test("overrideProps rewrites a prop and the DOM re-renders", async ({ page }) => {
    await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let childFiber = hostFiber?.return ?? null;
      while (childFiber && window.__BIPPY__.getDisplayName(childFiber.type) !== "TestChild") {
        childFiber = childFiber.return;
      }
      if (!childFiber) throw new Error("TestChild fiber not found");
      const latestFiber = window.__BIPPY__.getLatestFiber(childFiber);
      const renderer = window.__BIPPY__.getRenderer(latestFiber);
      if (!renderer?.overrideProps) throw new Error("renderer cannot override props");
      renderer.overrideProps(latestFiber, ["count"], 42);
    });
    await expect(page.getByTestId("test-child")).toHaveText("e2e-test 42");
  });

  test("overrideHookState rewrites state and dependent children re-render", async ({ page }) => {
    await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let parentFiber = hostFiber?.return ?? null;
      while (parentFiber && window.__BIPPY__.getDisplayName(parentFiber.type) !== "TestParent") {
        parentFiber = parentFiber.return;
      }
      if (!parentFiber) throw new Error("TestParent fiber not found");
      const latestFiber = window.__BIPPY__.getLatestFiber(parentFiber);
      const renderer = window.__BIPPY__.getRenderer(latestFiber);
      if (!renderer?.overrideHookState) throw new Error("renderer cannot override hook state");
      renderer.overrideHookState(latestFiber, 0, [], 7);
    });
    await expect(page.getByTestId("test-child")).toHaveText("e2e-test 7");
  });

  test("overrideProps rewrites a provider value and its consumers", async ({ page }) => {
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

      const contextType = consumerFiber.dependencies?.firstContext?.context;
      if (!contextType) throw new Error("context dependency not found");

      let providerFiber = consumerFiber.return;
      while (
        providerFiber &&
        providerFiber.type !== contextType &&
        providerFiber.type?.Provider !== contextType
      ) {
        providerFiber = providerFiber.return;
      }
      if (!providerFiber) throw new Error("context provider not found");

      const renderer = window.__BIPPY__.getRenderer(providerFiber);
      if (!renderer?.overrideProps) throw new Error("renderer cannot override props");
      renderer.overrideProps(providerFiber, ["value"], "overridden-value");
      if (providerFiber.alternate) {
        renderer.overrideProps(providerFiber.alternate, ["value"], "overridden-value");
      }
    });
    await expect(page.getByTestId("context-consumer")).toHaveText("overridden-value");
  });
});

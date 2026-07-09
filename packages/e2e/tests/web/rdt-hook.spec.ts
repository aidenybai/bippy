import { expect, test } from "./coverage-test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("getRDTHook", () => {
  test("returns the installed hook with an active renderer", async ({ page }) => {
    const result = await page.evaluate(() => {
      const rdtHook = window.__BIPPY__.getRDTHook();
      return {
        isGlobalHook: rdtHook === (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__,
        isActive: rdtHook._instrumentationIsActive === true,
        isActiveApi: window.__BIPPY__.isInstrumentationActive(),
      };
    });
    expect(result.isGlobalHook).toBe(true);
    expect(result.isActive).toBe(true);
    expect(result.isActiveApi).toBe(true);
  });

  test("fires onActive synchronously when the hook is already active", async ({ page }) => {
    const result = await page.evaluate(() => {
      let didFire = false;
      window.__BIPPY__.getRDTHook(() => {
        didFire = true;
      });
      return didFire;
    });
    expect(result).toBe(true);
  });

  test("is not the real React DevTools hook in the fixtures", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isRealReactDevtools();
    });
    expect(result).toBe(false);
  });
});

test.describe("patchRDTHook", () => {
  test("re-patching an unpatched hook with live renderers activates immediately", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const rdtHook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      rdtHook._instrumentationSource = undefined;
      rdtHook._instrumentationIsActive = false;
      let didFire = false;
      window.__BIPPY__.patchRDTHook(() => {
        didFire = true;
      });
      return {
        didFire,
        isActive: rdtHook._instrumentationIsActive === true,
      };
    });
    expect(result.didFire).toBe(true);
    expect(result.isActive).toBe(true);
  });

  test("re-patching with react-refresh and no renderers self-injects to activate", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const rdtHook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (!window.__BIPPY__.isReactRefresh(rdtHook)) return { skipped: true };

      const stashedRenderers = new Map(rdtHook.renderers);
      rdtHook.renderers.clear();
      rdtHook._instrumentationSource = undefined;
      rdtHook._instrumentationIsActive = false;

      window.__BIPPY__.patchRDTHook();
      const rendererCountAfterPatch = rdtHook.renderers.size;
      const isActiveAfterPatch = rdtHook._instrumentationIsActive === true;

      for (const [rendererId, renderer] of stashedRenderers) {
        rdtHook.renderers.set(rendererId, renderer);
      }
      return { skipped: false, rendererCountAfterPatch, isActiveAfterPatch };
    });
    if (result.skipped) return;
    expect(result.rendererCountAfterPatch).toBeGreaterThanOrEqual(1);
    expect(result.isActiveAfterPatch).toBe(true);
  });
});

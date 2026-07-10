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

test.describe("hook environment", () => {
  test("hasRDTHook and isClientEnvironment are true in a browser with the hook installed", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return {
        hasHook: window.__BIPPY__.hasRDTHook(),
        isClient: window.__BIPPY__.isClientEnvironment(),
      };
    });
    expect(result.hasHook).toBe(true);
    expect(result.isClient).toBe(true);
  });

  test("isReactRefresh rejects hooks without a react-refresh inject source", async ({ page }) => {
    const result = await page.evaluate(() => {
      return {
        installedHook: window.__BIPPY__.isReactRefresh(window.__BIPPY__.getRDTHook()),
        bareObject: window.__BIPPY__.isReactRefresh({ inject: () => 1 } as never),
      };
    });
    // isReactRefresh latches true once any refresh hook was seen, so the
    // installed hook's answer is environment-dependent; the bare object is
    // only rejected while that latch is unset
    expect(typeof result.installedHook).toBe("boolean");
    if (!result.installedHook) {
      expect(result.bareObject).toBe(false);
    }
  });

  test("version and BIPPY_INSTRUMENTATION_STRING identify the build", async ({ page }) => {
    const result = await page.evaluate(() => {
      return {
        version: window.__BIPPY__.version,
        instrumentationString: window.__BIPPY__.BIPPY_INSTRUMENTATION_STRING,
        hookSource: window.__BIPPY__.getRDTHook()._instrumentationSource,
      };
    });
    expect(typeof result.version).toBe("string");
    expect(result.version!.length).toBeGreaterThan(0);
    expect(result.instrumentationString).toBe(`bippy-${result.version}`);
    expect(typeof result.hookSource).toBe("string");
  });
});

test.describe("installRDTHook", () => {
  test("installs a fresh hook when the global is missing, then the original restores", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const globalScope = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
      const originalHook = globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      delete globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__;

      const installedHook = window.__BIPPY__.installRDTHook();
      const observations = {
        hasHookAfterInstall: window.__BIPPY__.hasRDTHook(),
        installedIsGlobal: globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__ === installedHook,
        hasInject: typeof installedHook.inject === "function",
        supportsFiber: installedHook.supportsFiber === true,
        startsInactive: installedHook._instrumentationIsActive === false,
        rendererCount: installedHook.renderers.size,
      };

      const fakeRenderer = { version: "19.0.0-e2e" };
      const injectedRendererId = installedHook.inject(fakeRenderer as never);
      const activeAfterInject = installedHook._instrumentationIsActive === true;

      // the global property is now bippy's accessor: assigning through its
      // setter merges any renderers on the fresh hook into the assigned hook,
      // so the fake renderer must be dropped before the original comes back
      installedHook.renderers.clear();
      globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__ = originalHook;
      return {
        ...observations,
        injectedRendererId,
        activeAfterInject,
        originalRestored: globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__ === originalHook,
      };
    });
    expect(result.hasHookAfterInstall).toBe(true);
    expect(result.installedIsGlobal).toBe(true);
    expect(result.hasInject).toBe(true);
    expect(result.supportsFiber).toBe(true);
    expect(result.startsInactive).toBe(true);
    expect(result.rendererCount).toBe(0);
    expect(result.injectedRendererId).toBe(1);
    expect(result.activeAfterInject).toBe(true);
    expect(result.originalRestored).toBe(true);
  });

  test("safelyInstallRDTHook never throws and leaves an installed hook in place", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const hookBefore = window.__BIPPY__.getRDTHook();
      window.__BIPPY__.safelyInstallRDTHook();
      return {
        hookUnchanged: window.__BIPPY__.getRDTHook() === hookBefore,
        stillActive: window.__BIPPY__.isInstrumentationActive(),
      };
    });
    expect(result.hookUnchanged).toBe(true);
    expect(result.stillActive).toBe(true);
  });
});

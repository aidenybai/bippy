import { expect, test } from "./coverage-test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("element validation", () => {
  test("isValidElement accepts live React elements and rejects non-elements", async ({ page }) => {
    const result = await page.evaluate(() => {
      const parentElement = document.querySelector('[data-testid="parent-host"]');
      const parentFiber = window.__BIPPY__.getFiberFromHostInstance(parentElement);
      if (!parentFiber) return null;
      const childElements = parentFiber.memoizedProps?.children;
      const firstChildElement = Array.isArray(childElements) ? childElements[0] : childElements;
      return {
        liveElement: window.__BIPPY__.isValidElement(firstChildElement),
        plainObject: window.__BIPPY__.isValidElement({}),
        null_: window.__BIPPY__.isValidElement(null),
        string: window.__BIPPY__.isValidElement("div"),
        fakeTypeof: window.__BIPPY__.isValidElement({ $$typeof: Symbol.for("react.portal") }),
      };
    });
    expect(result).not.toBeNull();
    expect(result!.liveElement).toBe(true);
    expect(result!.plainObject).toBe(false);
    expect(result!.null_).toBe(false);
    expect(result!.string).toBe(false);
    expect(result!.fakeTypeof).toBe(false);
  });
});

test.describe("context traversal", () => {
  // traverseContexts compares current and alternate dependencies, so the
  // consumer needs at least one re-render before an alternate fiber exists
  test.beforeEach(async ({ page }) => {
    await page.click('[data-testid="increment"]');
    await expect(page.getByTestId("test-child")).toHaveText("e2e-test 1");
  });

  test("traverseContexts reads the provided context value on a consumer fiber", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="context-consumer"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let consumerFiber = hostFiber.return;
      while (consumerFiber && !window.__BIPPY__.isCompositeFiber(consumerFiber)) {
        consumerFiber = consumerFiber.return;
      }
      if (!consumerFiber) return null;

      const contextValues: unknown[] = [];
      const didSelect = window.__BIPPY__.traverseContexts(consumerFiber, (nextContext) => {
        contextValues.push(nextContext?.memoizedValue);
      });
      return { contextValues, didSelect };
    });
    expect(result).not.toBeNull();
    // the selector never returns true, so traverseContexts reports no selection
    expect(result!.didSelect).toBe(false);
    expect(result!.contextValues).toContain("provided-value");
  });

  test("traverseContexts stops early when the selector returns true", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="context-consumer"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let consumerFiber = hostFiber.return;
      while (consumerFiber && !window.__BIPPY__.isCompositeFiber(consumerFiber)) {
        consumerFiber = consumerFiber.return;
      }
      if (!consumerFiber) return null;

      let visitCount = 0;
      window.__BIPPY__.traverseContexts(consumerFiber, () => {
        visitCount++;
        return true;
      });
      return visitCount;
    });
    expect(result).toBe(1);
  });
});

test.describe("fiber filtering", () => {
  test("shouldFilterFiber hides text fibers, keeps host and composite fibers", async ({ page }) => {
    const result = await page.evaluate(() => {
      // test-child renders `{name} {count}`: multiple text children, so React
      // creates real HostText fibers (a single text child gets inlined)
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }

      const textFiber = window.__BIPPY__.traverseFiber(
        hostFiber,
        (fiber) => typeof fiber.memoizedProps === "string",
      );

      return {
        hostFiltered: window.__BIPPY__.shouldFilterFiber(hostFiber),
        compositeFiltered: compositeFiber
          ? window.__BIPPY__.shouldFilterFiber(compositeFiber)
          : null,
        textFiltered: textFiber ? window.__BIPPY__.shouldFilterFiber(textFiber) : null,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.hostFiltered).toBe(false);
    expect(result!.compositeFiltered).toBe(false);
    expect(result!.textFiltered).toBe(true);
  });
});

test.describe("build type", () => {
  test("detectReactBuildType reports development for the fixture renderer", async ({ page }) => {
    const result = await page.evaluate(() => {
      const rdtHook = window.__BIPPY__.getRDTHook();
      const buildTypes: string[] = [];
      for (const renderer of rdtHook.renderers.values()) {
        buildTypes.push(window.__BIPPY__.detectReactBuildType(renderer));
      }
      return buildTypes;
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result).toContain("development");
  });
});

test.describe("fiber id assignment", () => {
  test("setFiberId pins an explicit id that getFiberId returns afterwards", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      window.__BIPPY__.setFiberId(fiber, 424_242);
      return window.__BIPPY__.getFiberId(fiber);
    });
    expect(result).toBe(424_242);
  });
});

test.describe("rendered fiber traversal", () => {
  // the first traverseRenderedFibers call on a root has no previous fiber and
  // reports the whole tree as "mount", so every scenario primes with one
  // observed commit before asserting incremental phases

  test("traverseRenderedFibers reports update phase for the re-rendered child", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return new Promise<Record<string, string>>((resolve) => {
        let commitCount = 0;
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            commitCount++;
            const phasesByName: Record<string, string> = {};
            window.__BIPPY__.traverseRenderedFibers(fiberRoot, (fiber, phase) => {
              const displayName = window.__BIPPY__.getDisplayName(fiber.type);
              if (displayName) phasesByName[displayName] = phase;
            });
            if (commitCount === 1) {
              document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
              return;
            }
            resolve(phasesByName);
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result.TestChild).toBe("update");
  });

  test("traverseRenderedFibers reports mount phase when the conditional child re-appears", async ({
    page,
  }) => {
    // deletions are not diffed by traverseRenderedFibers (React reports them
    // separately through onCommitFiberUnmount), so only the re-mount after a
    // toggle-off/toggle-on round trip is observable here
    const result = await page.evaluate(() => {
      return new Promise<string[]>((resolve) => {
        let commitCount = 0;
        const mountedTestIds: string[] = [];
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            commitCount++;
            window.__BIPPY__.traverseRenderedFibers(fiberRoot, (fiber, phase) => {
              if (commitCount === 1 || phase !== "mount") return;
              const testId = fiber.stateNode?.getAttribute?.("data-testid");
              if (testId) mountedTestIds.push(testId);
            });
            if (commitCount < 3) {
              document.querySelector<HTMLElement>('[data-testid="toggle-conditional"]')!.click();
              return;
            }
            resolve(mountedTestIds);
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result).toContain("conditional-child");
  });
});

test.describe("unmount and post-commit instrumentation", () => {
  test("onCommitFiberUnmount fires for the removed conditional child", async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ sawUnmount: boolean; rendererIdIsNumber: boolean }>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberUnmount: (rendererID, fiber) => {
            const testId = fiber.stateNode?.getAttribute?.("data-testid");
            if (testId === "conditional-child") {
              resolve({ sawUnmount: true, rendererIdIsNumber: typeof rendererID === "number" });
            }
          },
        });
        document.querySelector<HTMLElement>('[data-testid="toggle-conditional"]')!.click();
      });
    });
    expect(result.sawUnmount).toBe(true);
    expect(result.rendererIdIsNumber).toBe(true);
  });

  test("onPostCommitFiberRoot fires after a commit with passive effects", async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ rendererIdIsNumber: boolean; hasCurrentField: boolean }>((resolve) => {
        window.__BIPPY__.instrument({
          onPostCommitFiberRoot: (rendererID, fiberRoot) => {
            resolve({
              rendererIdIsNumber: typeof rendererID === "number",
              hasCurrentField: fiberRoot !== null && "current" in fiberRoot,
            });
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result.rendererIdIsNumber).toBe(true);
    expect(result.hasCurrentField).toBe(true);
  });
});

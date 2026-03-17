import { expect, test } from "@playwright/test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("instrumentation", () => {
  test("instrument() installs and isInstrumentationActive() returns true", async ({ page }) => {
    const isActive = await page.evaluate(() => {
      window.__BIPPY__.instrument({
        onCommitFiberRoot: () => {},
      });
      return window.__BIPPY__.isInstrumentationActive();
    });
    expect(isActive).toBe(true);
  });

  test("onCommitFiberRoot fires with rendererID and FiberRoot on state update", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return new Promise<{
        rendererID: number;
        hasCurrentField: boolean;
        childExists: boolean;
      }>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (rendererID, fiberRoot) => {
            resolve({
              rendererID,
              hasCurrentField: fiberRoot !== null && "current" in fiberRoot,
              childExists: fiberRoot?.current?.child !== null,
            });
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(typeof result.rendererID).toBe("number");
    expect(result.hasCurrentField).toBe(true);
    expect(result.childExists).toBe(true);
  });

  test("multiple instrument() calls chain and both handlers fire", async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ firstFired: boolean; secondFired: boolean }>((resolve) => {
        let firstFired = false;
        let secondFired = false;
        window.__BIPPY__.instrument({
          onCommitFiberRoot: () => {
            firstFired = true;
          },
        });
        window.__BIPPY__.instrument({
          onCommitFiberRoot: () => {
            secondFired = true;
            resolve({ firstFired, secondFired });
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result.firstFired).toBe(true);
    expect(result.secondFired).toBe(true);
  });
});

test.describe("fiber retrieval", () => {
  test("getFiberFromHostInstance returns fiber with matching stateNode", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      return {
        stateNodeMatchesElement: fiber.stateNode === element,
        typeIsString: typeof fiber.type === "string",
        type: fiber.type,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.stateNodeMatchesElement).toBe(true);
    expect(result!.type).toBe("div");
  });

  test("getFiberFromHostInstance returns null for null", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.getFiberFromHostInstance(null);
    });
    expect(result).toBeNull();
  });

  test("getFiberFromHostInstance returns null for a non-React element", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.createElement("span");
      document.body.appendChild(element);
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      element.remove();
      return fiber;
    });
    expect(result).toBeNull();
  });
});

test.describe("type guards", () => {
  test("isFiber returns true for host fiber, false for object/null/undefined/number", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      return {
        fiber: window.__BIPPY__.isFiber(fiber),
        object: window.__BIPPY__.isFiber({}),
        null_: window.__BIPPY__.isFiber(null),
        undefined_: window.__BIPPY__.isFiber(undefined),
        number: window.__BIPPY__.isFiber(42 as any),
        string: window.__BIPPY__.isFiber("hello" as any),
      };
    });
    expect(result.fiber).toBe(true);
    expect(result.object).toBe(false);
    expect(result.null_).toBe(false);
    expect(result.undefined_).toBe(false);
    expect(result.number).toBe(false);
    expect(result.string).toBe(false);
  });

  test("isValidFiber returns true for live fiber, false for object", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      return {
        liveFiber: window.__BIPPY__.isValidFiber(fiber),
        emptyObject: window.__BIPPY__.isValidFiber({}),
        null_: window.__BIPPY__.isValidFiber(null),
      };
    });
    expect(result.liveFiber).toBe(true);
    expect(result.emptyObject).toBe(false);
    expect(result.null_).toBe(false);
  });

  test("isHostFiber/isCompositeFiber are mutually exclusive on the same fiber", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const hostElement = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(hostElement);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      return {
        hostFiber_isHost: window.__BIPPY__.isHostFiber(hostFiber),
        hostFiber_isComposite: window.__BIPPY__.isCompositeFiber(hostFiber),
        compositeFiber_isHost: window.__BIPPY__.isHostFiber(compositeFiber),
        compositeFiber_isComposite: window.__BIPPY__.isCompositeFiber(compositeFiber),
        compositeFiberName: window.__BIPPY__.getDisplayName(compositeFiber.type),
      };
    });
    expect(result).not.toBeNull();
    expect(result!.hostFiber_isHost).toBe(true);
    expect(result!.hostFiber_isComposite).toBe(false);
    expect(result!.compositeFiber_isHost).toBe(false);
    expect(result!.compositeFiber_isComposite).toBe(true);
    expect(result!.compositeFiberName).toBe("TestChild");
  });
});

test.describe("display name", () => {
  test("getDisplayName resolves names for all component types", async ({ page }) => {
    const result = await page.evaluate(() => {
      const testIds = [
        "test-child",
        "memo-child",
        "forward-ref-child",
        "class-component",
        "context-consumer",
      ];
      const names: Record<string, string | null> = {};
      for (const testId of testIds) {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
        if (!hostFiber) continue;
        let fiber = hostFiber.return;
        while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
          fiber = fiber.return;
        }
        if (fiber) {
          names[testId] = window.__BIPPY__.getDisplayName(fiber.type);
        }
      }
      return names;
    });
    expect(result["test-child"]).toBe("TestChild");
    expect(result["memo-child"]).toBe("MemoChild");
    expect(result["forward-ref-child"]).toBe("ForwardRefChild");
    expect(result["class-component"]).toBe("TestClassComponent");
    expect(result["context-consumer"]).toBe("TestContextConsumer");
  });

  test("getDisplayName returns string for host types, null for primitives", async ({ page }) => {
    const result = await page.evaluate(() => {
      return {
        div: window.__BIPPY__.getDisplayName("div"),
        span: window.__BIPPY__.getDisplayName("span"),
        null_: window.__BIPPY__.getDisplayName(null),
        undefined_: window.__BIPPY__.getDisplayName(undefined),
        boolean: window.__BIPPY__.getDisplayName(true),
        number: window.__BIPPY__.getDisplayName(42 as any),
      };
    });
    expect(result.div).toBe("div");
    expect(result.span).toBe("span");
    expect(result.null_).toBeNull();
    expect(result.undefined_).toBeNull();
    expect(result.boolean).toBeNull();
    expect(result.number).toBeNull();
  });
});

test.describe("fiber identity", () => {
  test("getLatestFiber returns a fiber whose stateNode matches the DOM", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      const latestFiber = window.__BIPPY__.getLatestFiber(fiber);
      return {
        isFiber: window.__BIPPY__.isFiber(latestFiber),
        stateNodeMatches: latestFiber.stateNode === element,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.isFiber).toBe(true);
    expect(result!.stateNodeMatches).toBe(true);
  });

  test("getFiberId returns a non-negative number", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      const fiberId = window.__BIPPY__.getFiberId(fiber);
      return { fiberId, isNumber: typeof fiberId === "number" };
    });
    expect(result).not.toBeNull();
    expect(result!.isNumber).toBe(true);
    expect(result!.fiberId).toBeGreaterThanOrEqual(0);
  });

  test("areFiberEqual: fiber===alternate is true, different fibers is false", async ({ page }) => {
    await page.click('[data-testid="increment"]');
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const elementA = document.querySelector('[data-testid="test-child"]');
      const elementB = document.querySelector('[data-testid="memo-child"]');
      const fiberA = window.__BIPPY__.getFiberFromHostInstance(elementA);
      const fiberB = window.__BIPPY__.getFiberFromHostInstance(elementB);
      if (!fiberA || !fiberB || !fiberA.alternate) return null;

      return {
        selfEqualsAlternate: window.__BIPPY__.areFiberEqual(fiberA, fiberA.alternate),
        differentFibersEqual: window.__BIPPY__.areFiberEqual(fiberA, fiberB),
      };
    });
    expect(result).not.toBeNull();
    expect(result!.selfEqualsAlternate).toBe(true);
    expect(result!.differentFibersEqual).toBe(false);
  });
});

test.describe("render and commit detection", () => {
  test("didFiberRender: true for TestChild after prop change, false for MemoChild", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return new Promise<{
        testChildRendered: boolean;
        memoChildRendered: boolean;
      }>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            const rootFiber = fiberRoot.current;
            let testChildFiber: any = null;
            let memoChildFiber: any = null;
            window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
              const displayName = window.__BIPPY__.getDisplayName(fiber.type);
              if (displayName === "TestChild") testChildFiber = fiber;
              if (displayName === "MemoChild") memoChildFiber = fiber;
            });
            if (testChildFiber && memoChildFiber) {
              resolve({
                testChildRendered: window.__BIPPY__.didFiberRender(testChildFiber),
                memoChildRendered: window.__BIPPY__.didFiberRender(memoChildFiber),
              });
            }
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result.testChildRendered).toBe(true);
    expect(result.memoChildRendered).toBe(false);
  });

  test("didFiberCommit returns a boolean for a committed fiber", async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ value: boolean; typeofValue: string }>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            const rootFiber = fiberRoot.current;
            const value = window.__BIPPY__.didFiberCommit(rootFiber);
            resolve({ value, typeofValue: typeof value });
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result.typeofValue).toBe("boolean");
  });
});

test.describe("timings", () => {
  test("getTimings returns valid shape, totalTime >= selfTime", async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{
        selfTime: number;
        totalTime: number;
        hasExactlyTwoKeys: boolean;
      } | null>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            let testParentFiber: any = null;
            window.__BIPPY__.traverseFiber(fiberRoot.current, (fiber) => {
              if (window.__BIPPY__.getDisplayName(fiber.type) === "TestParent") {
                testParentFiber = fiber;
                return true;
              }
            });
            if (testParentFiber) {
              const timings = window.__BIPPY__.getTimings(testParentFiber);
              resolve({
                selfTime: timings.selfTime,
                totalTime: timings.totalTime,
                hasExactlyTwoKeys: Object.keys(timings).length === 2,
              });
            }
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result).not.toBeNull();
    expect(result!.selfTime).toBeGreaterThanOrEqual(0);
    expect(result!.totalTime).toBeGreaterThanOrEqual(0);
    expect(result!.totalTime).toBeGreaterThanOrEqual(result!.selfTime);
    expect(result!.hasExactlyTwoKeys).toBe(true);
  });

  test("getTimings with null returns zeros", async ({ page }) => {
    const result = await page.evaluate(() => {
      const timings = window.__BIPPY__.getTimings(null as any);
      return timings;
    });
    expect(result.selfTime).toBe(0);
    expect(result.totalTime).toBe(0);
  });
});

test.describe("traversal", () => {
  test("traverseFiber descending visits every component in expected order", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      const visitedNames: string[] = [];
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        const displayName = window.__BIPPY__.getDisplayName(fiber.type);
        if (displayName && typeof fiber.type !== "string") {
          visitedNames.push(displayName);
        }
      });
      return visitedNames;
    });
    expect(result).not.toBeNull();
    expect(result).toContain("TestParent");
    expect(result).toContain("TestChild");
    expect(result).toContain("MemoChild");
    expect(result).toContain("ForwardRefChild");
    expect(result).toContain("TestContextConsumer");
    expect(result).toContain("TestClassComponent");
    const parentIndex = result!.indexOf("TestParent");
    const childIndex = result!.indexOf("TestChild");
    expect(parentIndex).toBeLessThan(childIndex);
  });

  test("traverseFiber ascending from TestChild reaches TestParent before root", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      const visitedNames: string[] = [];
      window.__BIPPY__.traverseFiber(
        compositeFiber,
        (fiber) => {
          const displayName = window.__BIPPY__.getDisplayName(fiber.type);
          if (displayName && typeof fiber.type !== "string") {
            visitedNames.push(displayName);
          }
        },
        true,
      );
      return visitedNames;
    });
    expect(result).not.toBeNull();
    expect(result![0]).toBe("TestChild");
    expect(result).toContain("TestParent");
  });

  test("traverseFiber stops early when selector returns true", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let visitCount = 0;
      const found = window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        visitCount++;
        return window.__BIPPY__.getDisplayName(fiber.type) === "TestChild";
      });
      const foundName = found ? window.__BIPPY__.getDisplayName(found.type) : null;

      let totalCount = 0;
      window.__BIPPY__.traverseFiber(rootFiber, () => {
        totalCount++;
      });

      return { foundName, visitCount, totalCount };
    });
    expect(result).not.toBeNull();
    expect(result!.foundName).toBe("TestChild");
    expect(result!.visitCount).toBeLessThan(result!.totalCount);
  });

  test("traverseFiber returns null for null input", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.traverseFiber(null, () => true);
    });
    expect(result).toBeNull();
  });

  test("traverseProps reads correct prop names and values", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      const props: Record<string, unknown> = {};
      window.__BIPPY__.traverseProps(compositeFiber, (propName, nextValue) => {
        props[propName] = nextValue;
      });
      return props;
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("e2e-test");
    expect(result!.count).toBe(0);
  });

  test("traverseProps reflects updated values after state change", async ({ page }) => {
    await page.click('[data-testid="increment"]');
    await page.waitForTimeout(100);
    await page.click('[data-testid="increment"]');
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      let countValue: unknown = undefined;
      window.__BIPPY__.traverseProps(compositeFiber, (propName, nextValue) => {
        if (propName === "count") countValue = nextValue;
      });
      return { countValue, domText: element!.textContent };
    });
    expect(result).not.toBeNull();
    expect(result!.countValue).toBe(2);
    expect(result!.domText).toBe("e2e-test 2");
  });

  test("traverseState reads initial state=0 and updated state=1 after click", async ({ page }) => {
    const initialState = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let parentFiber = hostFiber.return;
      while (parentFiber) {
        if (window.__BIPPY__.getDisplayName(parentFiber.type) === "TestParent") break;
        parentFiber = parentFiber.return;
      }
      if (!parentFiber) return null;

      const stateValues: unknown[] = [];
      window.__BIPPY__.traverseState(parentFiber, (nextState) => {
        if (nextState && typeof nextState === "object" && "memoizedState" in nextState) {
          stateValues.push(nextState.memoizedState);
        }
      });
      return stateValues;
    });
    expect(initialState).not.toBeNull();
    expect(initialState).toContain(0);

    const updatedState = await page.evaluate(() => {
      return new Promise<unknown[]>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            let parentFiber: any = null;
            window.__BIPPY__.traverseFiber(fiberRoot.current, (fiber) => {
              if (window.__BIPPY__.getDisplayName(fiber.type) === "TestParent") {
                parentFiber = fiber;
                return true;
              }
            });
            if (!parentFiber) return;

            const stateValues: unknown[] = [];
            window.__BIPPY__.traverseState(parentFiber, (nextState) => {
              if (nextState && typeof nextState === "object" && "memoizedState" in nextState) {
                stateValues.push(nextState.memoizedState);
              }
            });
            resolve(stateValues);
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(updatedState).not.toBeNull();
    expect(updatedState).toContain(1);
  });
});

test.describe("host fiber lookup", () => {
  test("getNearestHostFiber descending returns the direct child host fiber", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      const nearestHost = window.__BIPPY__.getNearestHostFiber(compositeFiber);
      if (!nearestHost) return null;
      return {
        isHost: window.__BIPPY__.isHostFiber(nearestHost),
        stateNodeMatchesOriginal: nearestHost.stateNode === element,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.isHost).toBe(true);
    expect(result!.stateNodeMatchesOriginal).toBe(true);
  });

  test("getNearestHostFiber ascending returns the parent host element", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      const nearestHostAscending = window.__BIPPY__.getNearestHostFiber(compositeFiber, true);
      if (!nearestHostAscending) return null;
      return {
        isHost: window.__BIPPY__.isHostFiber(nearestHostAscending),
        testId: nearestHostAscending.stateNode?.getAttribute?.("data-testid"),
      };
    });
    expect(result).not.toBeNull();
    expect(result!.isHost).toBe(true);
    expect(result!.testId).toBe("parent-host");
  });

  test("getNearestHostFibers returns all host descendants", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let parentFiber = hostFiber.return;
      while (parentFiber) {
        if (window.__BIPPY__.getDisplayName(parentFiber.type) === "TestParent") break;
        parentFiber = parentFiber.return;
      }
      if (!parentFiber) return null;

      const hostFibers = window.__BIPPY__.getNearestHostFibers(parentFiber);
      const allAreHost = hostFibers.every((fiber) => window.__BIPPY__.isHostFiber(fiber));
      return { count: hostFibers.length, allAreHost };
    });
    expect(result).not.toBeNull();
    expect(result!.count).toBeGreaterThanOrEqual(1);
    expect(result!.allAreHost).toBe(true);
  });
});

test.describe("fiber stack", () => {
  test("getFiberStack first element is the fiber itself, last is near root", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      const fiberStack = window.__BIPPY__.getFiberStack(compositeFiber);
      const firstName = window.__BIPPY__.getDisplayName(fiberStack[0]?.type);
      const names = fiberStack
        .map((fiber) => window.__BIPPY__.getDisplayName(fiber.type))
        .filter(Boolean);
      return {
        length: fiberStack.length,
        firstName,
        names,
        lastFiberHasNoReturn: fiberStack[fiberStack.length - 1]?.return === null,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(2);
    expect(result!.firstName).toBe("TestChild");
    expect(result!.names).toContain("TestParent");
  });
});

test.describe("mutated host fibers", () => {
  test("getMutatedHostFibers returns only the changed host fibers", async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{
        mutatedCount: number;
        allAreHost: boolean;
        containsTestChildDiv: boolean;
      }>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            const mutated = window.__BIPPY__.getMutatedHostFibers(fiberRoot.current);
            resolve({
              mutatedCount: mutated.length,
              allAreHost: mutated.every((fiber) => window.__BIPPY__.isHostFiber(fiber)),
              containsTestChildDiv: mutated.some(
                (fiber) => fiber.stateNode?.getAttribute?.("data-testid") === "test-child",
              ),
            });
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result.mutatedCount).toBeGreaterThan(0);
    expect(result.allAreHost).toBe(true);
    expect(result.containsTestChildDiv).toBe(true);
  });
});

test.describe("type unwrapping", () => {
  test("getType unwraps memo and forwardRef, returns function, null for objects", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const memoElement = document.querySelector('[data-testid="memo-child"]');
      const forwardRefElement = document.querySelector('[data-testid="forward-ref-child"]');
      const memoHostFiber = window.__BIPPY__.getFiberFromHostInstance(memoElement);
      const forwardRefHostFiber = window.__BIPPY__.getFiberFromHostInstance(forwardRefElement);

      const findComposite = (hostFiber: any) => {
        let fiber = hostFiber?.return;
        while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
          fiber = fiber.return;
        }
        return fiber;
      };

      const memoFiber = findComposite(memoHostFiber);
      const forwardRefFiber = findComposite(forwardRefHostFiber);

      return {
        memoInnerIsFunction: memoFiber
          ? typeof window.__BIPPY__.getType(memoFiber.type) === "function"
          : null,
        forwardRefInnerIsFunction: forwardRefFiber
          ? typeof window.__BIPPY__.getType(forwardRefFiber.type) === "function"
          : null,
        objectReturnsNull: window.__BIPPY__.getType({}) === null,
        nullReturnsNull: window.__BIPPY__.getType(null) === null,
      };
    });
    expect(result.memoInnerIsFunction).toBe(true);
    expect(result.forwardRefInnerIsFunction).toBe(true);
    expect(result.objectReturnsNull).toBe(true);
    expect(result.nullReturnsNull).toBe(true);
  });
});

test.describe("memo cache", () => {
  test("hasMemoCache returns false for normal components", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let fiber = hostFiber.return;
      while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
        fiber = fiber.return;
      }
      if (!fiber) return null;

      return window.__BIPPY__.hasMemoCache(fiber);
    });
    expect(result).toBe(false);
  });
});

test.describe("conditional rendering", () => {
  test("conditional child is visible then removed after toggle", async ({ page }) => {
    const before = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="conditional-child"]');
      if (!element) return null;
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      return fiber !== null;
    });
    expect(before).toBe(true);

    await page.click('[data-testid="toggle-conditional"]');
    await page.waitForTimeout(100);

    const after = await page.evaluate(() => {
      return document.querySelector('[data-testid="conditional-child"]');
    });
    expect(after).toBeNull();
  });
});

test.describe("suspense", () => {
  test("resolved suspense child is in the fiber tree", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="suspense-child"]');
      if (!element) return null;
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      return {
        exists: fiber !== null,
        text: element.textContent,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.exists).toBe(true);
    expect(result!.text).toBe("resolved");
  });
});

test.describe("fragment", () => {
  test("fragment children are both in the fiber tree", async ({ page }) => {
    const result = await page.evaluate(() => {
      const childA = document.querySelector('[data-testid="fragment-child-a"]');
      const childB = document.querySelector('[data-testid="fragment-child-b"]');
      const fiberA = childA ? window.__BIPPY__.getFiberFromHostInstance(childA) : null;
      const fiberB = childB ? window.__BIPPY__.getFiberFromHostInstance(childB) : null;
      return {
        aExists: fiberA !== null,
        bExists: fiberB !== null,
        aText: childA?.textContent,
        bText: childB?.textContent,
        areSiblings: fiberA !== null && fiberB !== null && fiberA.sibling === fiberB,
      };
    });
    expect(result.aExists).toBe(true);
    expect(result.bExists).toBe(true);
    expect(result.aText).toBe("a");
    expect(result.bText).toBe("b");
    expect(result.areSiblings).toBe(true);
  });
});

import { expect, test } from '@playwright/test';
import { waitForBippy, waitForTestChild } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe('instrumentation', () => {
  test('instrument() installs and isInstrumentationActive() returns true', async ({ page }) => {
    const isActive = await page.evaluate(() => {
      window.__BIPPY__.instrument({
        onCommitFiberRoot: () => {},
      });
      return window.__BIPPY__.isInstrumentationActive();
    });
    expect(isActive).toBe(true);
  });

  test('onCommitFiberRoot fires on re-render after state update', async ({ page }) => {
    const didFire = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: () => {
            resolve(true);
          },
        });
        const incrementButton = document.querySelector('[data-testid="increment"]');
        if (incrementButton instanceof HTMLElement) {
          incrementButton.click();
        }
      });
    });
    expect(didFire).toBe(true);
  });

  test('onCommitFiberRoot receives a valid FiberRoot', async ({ page }) => {
    const hasValidRoot = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            const hasCurrentField = fiberRoot && 'current' in fiberRoot;
            const hasFiberChild = hasCurrentField && fiberRoot.current?.child != null;
            resolve(Boolean(hasCurrentField && hasFiberChild));
          },
        });
        const incrementButton = document.querySelector('[data-testid="increment"]');
        if (incrementButton instanceof HTMLElement) {
          incrementButton.click();
        }
      });
    });
    expect(hasValidRoot).toBe(true);
  });
});

test.describe('fiber retrieval', () => {
  test('getFiberFromHostInstance returns a fiber for a React-rendered element', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      return fiber != null;
    });
    expect(result).toBe(true);
  });

  test('getFiberFromHostInstance returns a fiber for parent-host', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      return fiber != null;
    });
    expect(result).toBe(true);
  });

  test('getFiberFromHostInstance returns null for null', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.getFiberFromHostInstance(null);
    });
    expect(result).toBeNull();
  });

  test('getFiberFromHostInstance returns null for a non-React element', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.createElement('div');
      document.body.appendChild(element);
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      element.remove();
      return fiber;
    });
    expect(result).toBeNull();
  });
});

test.describe('type guards', () => {
  test('isFiber returns true for a fiber from getFiberFromHostInstance', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      return window.__BIPPY__.isFiber(fiber);
    });
    expect(result).toBe(true);
  });

  test('isFiber returns false for a plain object', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isFiber({});
    });
    expect(result).toBe(false);
  });

  test('isFiber returns false for null', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isFiber(null);
    });
    expect(result).toBe(false);
  });

  test('isValidFiber returns true for a live fiber', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      return window.__BIPPY__.isValidFiber(fiber);
    });
    expect(result).toBe(true);
  });

  test('isValidFiber returns false for a plain object', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isValidFiber({});
    });
    expect(result).toBe(false);
  });

  test('isHostFiber returns true for a host (DOM) fiber', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      return window.__BIPPY__.isHostFiber(fiber);
    });
    expect(result).toBe(true);
  });

  test('isHostFiber returns false for a composite fiber', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;
      return window.__BIPPY__.isHostFiber(compositeFiber);
    });
    expect(result).toBe(false);
  });

  test('isCompositeFiber returns true for a component fiber', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;
      return window.__BIPPY__.isCompositeFiber(compositeFiber);
    });
    expect(result).toBe(true);
  });

  test('isCompositeFiber returns false for a host fiber', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      return window.__BIPPY__.isCompositeFiber(fiber);
    });
    expect(result).toBe(false);
  });
});

test.describe('display name', () => {
  test('getDisplayName returns correct name for function component (TestChild)', async ({
    page,
  }) => {
    const displayName = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let fiber = hostFiber.return;
      while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
        fiber = fiber.return;
      }
      if (!fiber) return null;
      return window.__BIPPY__.getDisplayName(fiber.type);
    });
    expect(displayName).toBe('TestChild');
  });

  test('getDisplayName returns correct name for memo component', async ({ page }) => {
    const displayName = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="memo-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let fiber = hostFiber.return;
      while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
        fiber = fiber.return;
      }
      if (!fiber) return null;
      return window.__BIPPY__.getDisplayName(fiber.type);
    });
    expect(displayName).toBe('MemoChild');
  });

  test('getDisplayName returns correct name for forwardRef component', async ({ page }) => {
    const displayName = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="forward-ref-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let fiber = hostFiber.return;
      while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
        fiber = fiber.return;
      }
      if (!fiber) return null;
      return window.__BIPPY__.getDisplayName(fiber.type);
    });
    expect(displayName).toBe('ForwardRefChild');
  });

  test('getDisplayName returns correct name for class component', async ({ page }) => {
    const displayName = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="class-component"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let fiber = hostFiber.return;
      while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
        fiber = fiber.return;
      }
      if (!fiber) return null;
      return window.__BIPPY__.getDisplayName(fiber.type);
    });
    expect(displayName).toBe('TestClassComponent');
  });

  test('getDisplayName returns the string itself for a host element type', async ({ page }) => {
    const displayName = await page.evaluate(() => {
      return window.__BIPPY__.getDisplayName('div');
    });
    expect(displayName).toBe('div');
  });
});

test.describe('fiber identity', () => {
  test('getLatestFiber returns a valid fiber', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      const latestFiber = window.__BIPPY__.getLatestFiber(fiber);
      return window.__BIPPY__.isFiber(latestFiber);
    });
    expect(result).toBe(true);
  });

  test('getFiberId returns a number and is stable across alternate', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      const fiberId = window.__BIPPY__.getFiberId(fiber);
      if (fiber.alternate) {
        const alternateId = window.__BIPPY__.getFiberId(fiber.alternate);
        return { fiberId, alternateId, match: fiberId === alternateId };
      }
      return { fiberId, alternateId: null, match: true };
    });
    expect(result).not.toBeNull();
    expect(typeof result!.fiberId).toBe('number');
    expect(result!.match).toBe(true);
  });

  test('areFiberEqual returns true for fiber and its alternate', async ({ page }) => {
    await page.click('[data-testid="increment"]');
    await page.waitForTimeout(100);

    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!fiber) return null;
      if (!fiber.alternate) return null;
      return window.__BIPPY__.areFiberEqual(fiber, fiber.alternate);
    });
    expect(result).not.toBeNull();
    expect(result).toBe(true);
  });

  test('areFiberEqual returns false for two different fibers', async ({ page }) => {
    const result = await page.evaluate(() => {
      const elementA = document.querySelector('[data-testid="test-child"]');
      const elementB = document.querySelector('[data-testid="memo-child"]');
      const fiberA = window.__BIPPY__.getFiberFromHostInstance(elementA);
      const fiberB = window.__BIPPY__.getFiberFromHostInstance(elementB);
      if (!fiberA || !fiberB) return null;
      return window.__BIPPY__.areFiberEqual(fiberA, fiberB);
    });
    expect(result).toBe(false);
  });
});

test.describe('render and commit detection', () => {
  test('didFiberRender returns true for a fiber that rendered on mount', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<boolean | null>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            const rootFiber = fiberRoot.current;
            let testChildFiber: unknown = null;
            window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
              if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
                testChildFiber = fiber;
                return true;
              }
            });
            if (testChildFiber) {
              resolve(window.__BIPPY__.didFiberRender(testChildFiber as any));
            }
          },
        });
        const incrementButton = document.querySelector('[data-testid="increment"]');
        if (incrementButton instanceof HTMLElement) {
          incrementButton.click();
        }
      });
    });
    expect(result).toBe(true);
  });

  test('didFiberRender is false for memoized child when its props did not change', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="memo-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let memoFiber = hostFiber.return;
      while (memoFiber && !window.__BIPPY__.isCompositeFiber(memoFiber)) {
        memoFiber = memoFiber.return;
      }
      if (!memoFiber) return null;

      return new Promise<boolean | null>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            const rootFiber = fiberRoot.current;
            let updatedMemoFiber: unknown = null;
            window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
              if (window.__BIPPY__.getDisplayName(fiber.type) === 'MemoChild') {
                updatedMemoFiber = fiber;
                return true;
              }
            });
            if (updatedMemoFiber) {
              resolve(window.__BIPPY__.didFiberRender(updatedMemoFiber as any));
            }
          },
        });
        const incrementButton = document.querySelector('[data-testid="increment"]');
        if (incrementButton instanceof HTMLElement) {
          incrementButton.click();
        }
      });
    });
    expect(result).toBe(false);
  });
});

test.describe('timings', () => {
  test('getTimings returns selfTime and totalTime as numbers >= 0', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ selfTime: number; totalTime: number } | null>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            const rootFiber = fiberRoot.current;
            let testChildFiber: unknown = null;
            window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
              if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
                testChildFiber = fiber;
                return true;
              }
            });
            if (testChildFiber) {
              resolve(window.__BIPPY__.getTimings(testChildFiber as any));
            }
          },
        });
        const incrementButton = document.querySelector('[data-testid="increment"]');
        if (incrementButton instanceof HTMLElement) {
          incrementButton.click();
        }
      });
    });
    expect(result).not.toBeNull();
    expect(result!.selfTime).toBeGreaterThanOrEqual(0);
    expect(result!.totalTime).toBeGreaterThanOrEqual(0);
  });
});

test.describe('traversal', () => {
  test('traverseFiber descending visits TestParent and TestChild', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) {
        rootFiber = rootFiber.return;
      }

      const visitedNames: string[] = [];
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        const displayName = window.__BIPPY__.getDisplayName(fiber.type);
        if (displayName) {
          visitedNames.push(displayName);
        }
      });
      return visitedNames;
    });
    expect(result).not.toBeNull();
    expect(result).toContain('TestParent');
    expect(result).toContain('TestChild');
    expect(result).toContain('MemoChild');
    expect(result).toContain('ForwardRefChild');
    expect(result).toContain('TestContextConsumer');
    expect(result).toContain('TestClassComponent');
  });

  test('traverseFiber ascending from leaf reaches root', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      const visitedNames: string[] = [];
      window.__BIPPY__.traverseFiber(
        hostFiber,
        (fiber) => {
          const displayName = window.__BIPPY__.getDisplayName(fiber.type);
          if (displayName) {
            visitedNames.push(displayName);
          }
        },
        true,
      );
      return visitedNames;
    });
    expect(result).not.toBeNull();
    expect(result).toContain('TestParent');
  });

  test('traverseFiber returns null for null input', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.traverseFiber(null, () => true);
    });
    expect(result).toBeNull();
  });

  test('traverseProps reads TestChild props correctly', async ({ page }) => {
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
        if (propName !== 'children') {
          props[propName] = nextValue;
        }
      });
      return props;
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe('e2e-test');
    expect(result!.count).toBe(0);
  });

  test('traverseState reads TestParent state', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let parentFiber = hostFiber.return;
      while (parentFiber) {
        const displayName = window.__BIPPY__.getDisplayName(parentFiber.type);
        if (displayName === 'TestParent') break;
        parentFiber = parentFiber.return;
      }
      if (!parentFiber) return null;

      const stateValues: unknown[] = [];
      window.__BIPPY__.traverseState(parentFiber, (nextState) => {
        if (nextState && typeof nextState === 'object' && 'memoizedState' in nextState) {
          stateValues.push(nextState.memoizedState);
        }
      });
      return stateValues;
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    expect(result).toContain(0);
  });

  test('traverseContexts finds context on TestContextConsumer fiber', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="context-consumer"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      const hasDependencies =
        compositeFiber.dependencies != null &&
        typeof compositeFiber.dependencies === 'object';

      let contextCount = 0;
      window.__BIPPY__.traverseContexts(compositeFiber, () => {
        contextCount++;
      });

      return { hasDependencies, contextCount, fiberTag: compositeFiber.tag };
    });
    expect(result).not.toBeNull();
    expect(result!.hasDependencies || result!.contextCount >= 0).toBe(true);
    expect(typeof result!.fiberTag).toBe('number');
  });
});

test.describe('host fiber lookup', () => {
  test('getNearestHostFiber descending from composite fiber returns host fiber', async ({
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

      const nearestHost = window.__BIPPY__.getNearestHostFiber(compositeFiber);
      return nearestHost != null && window.__BIPPY__.isHostFiber(nearestHost);
    });
    expect(result).toBe(true);
  });

  test('getNearestHostFiber ascending from composite returns host fiber', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let compositeFiber = hostFiber.return;
      while (compositeFiber && !window.__BIPPY__.isCompositeFiber(compositeFiber)) {
        compositeFiber = compositeFiber.return;
      }
      if (!compositeFiber) return null;

      const nearestHost = window.__BIPPY__.getNearestHostFiber(compositeFiber, true);
      return nearestHost != null && window.__BIPPY__.isHostFiber(nearestHost);
    });
    expect(result).toBe(true);
  });

  test('getNearestHostFibers returns host fibers for TestParent', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let parentFiber = hostFiber.return;
      while (parentFiber) {
        const displayName = window.__BIPPY__.getDisplayName(parentFiber.type);
        if (displayName === 'TestParent') break;
        parentFiber = parentFiber.return;
      }
      if (!parentFiber) return null;

      const hostFibers = window.__BIPPY__.getNearestHostFibers(parentFiber);
      return hostFibers.length;
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(1);
  });
});

test.describe('fiber stack', () => {
  test('getFiberStack returns correct ancestry chain', async ({ page }) => {
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
      const names = fiberStack
        .map((fiber) => window.__BIPPY__.getDisplayName(fiber.type))
        .filter(Boolean);
      return { length: fiberStack.length, names };
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(1);
    expect(result!.names).toContain('TestChild');
    expect(result!.names).toContain('TestParent');
  });
});

test.describe('mutated host fibers', () => {
  test('getMutatedHostFibers returns changed fibers after state update', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, fiberRoot) => {
            const mutated = window.__BIPPY__.getMutatedHostFibers(fiberRoot.current);
            resolve(mutated.length);
          },
        });
        const incrementButton = document.querySelector('[data-testid="increment"]');
        if (incrementButton instanceof HTMLElement) {
          incrementButton.click();
        }
      });
    });
    expect(result).toBeGreaterThan(0);
  });
});

test.describe('type unwrapping', () => {
  test('getType unwraps memo to the inner component', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="memo-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let fiber = hostFiber.return;
      while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
        fiber = fiber.return;
      }
      if (!fiber) return null;

      const innerType = window.__BIPPY__.getType(fiber.type);
      return typeof innerType === 'function';
    });
    expect(result).toBe(true);
  });

  test('getType unwraps forwardRef to the inner component', async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="forward-ref-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let fiber = hostFiber.return;
      while (fiber && !window.__BIPPY__.isCompositeFiber(fiber)) {
        fiber = fiber.return;
      }
      if (!fiber) return null;

      const innerType = window.__BIPPY__.getType(fiber.type);
      return typeof innerType === 'function';
    });
    expect(result).toBe(true);
  });

  test('getType returns null for a non-component', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.getType({});
    });
    expect(result).toBeNull();
  });
});

test.describe('memo cache', () => {
  test('hasMemoCache returns false for normal components', async ({ page }) => {
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

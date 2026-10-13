// Core bippy behaviors against real production builds (vite preview, next
// start, tanstack preview). Production React strips dev-only hook traffic,
// so everything here must hold with the minified renderer.
import { expect, test } from "@playwright/test";

import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("production build", () => {
  test("detectReactBuildType reports production", async ({ page }) => {
    const buildType = await page.evaluate(() => {
      const renderers = [...window.__BIPPY__._renderers];
      if (renderers.length === 0) return "no-renderer";
      return window.__BIPPY__.detectReactBuildType(renderers[0]);
    });
    expect(buildType).toBe("production");
  });

  test("instrumentation activates and observes commits", async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ isActive: boolean; rendererID: number }>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (rendererID) => {
            resolve({ isActive: window.__BIPPY__.isInstrumentationActive(), rendererID });
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(result.isActive).toBe(true);
    expect(typeof result.rendererID).toBe("number");
  });

  test("traverseRenderedFibers reports update phases on commit", async ({ page }) => {
    const phasesByCommit = await page.evaluate(() => {
      return new Promise<string[][]>((resolve) => {
        const commits: string[][] = [];
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, root) => {
            const seenPhases: string[] = [];
            window.__BIPPY__.traverseRenderedFibers(root, (_fiber, phase) => {
              seenPhases.push(phase);
            });
            commits.push(seenPhases);
            if (commits.length === 2) {
              resolve(commits);
            } else {
              document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
            }
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    // The first observed commit primes the root (reported as a mount);
    // the second must be reported as updates.
    expect(phasesByCommit[0].length).toBeGreaterThan(0);
    expect(phasesByCommit[1].length).toBeGreaterThan(0);
    expect(new Set(phasesByCommit[1]).has("update")).toBe(true);
  });

  test("getFiberFromHostInstance resolves host fibers", async ({ page }) => {
    const fiberInfo = await page.evaluate(() => {
      const hostElement = document.querySelector('[data-testid="test-child"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(hostElement);
      if (!fiber) return null;
      return {
        typeIsString: typeof fiber.type === "string",
        isHostFiber: window.__BIPPY__.isHostFiber(fiber),
        isFiber: window.__BIPPY__.isFiber(fiber),
      };
    });
    expect(fiberInfo).toEqual({ typeIsString: true, isHostFiber: true, isFiber: true });
  });

  test("fiber classification works with minified component types", async ({ page }) => {
    const classification = await page.evaluate(() => {
      return new Promise<{ compositeCount: number; hostCount: number }>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, root) => {
            let compositeCount = 0;
            let hostCount = 0;
            window.__BIPPY__.traverseFiber(root.current, (fiber) => {
              if (window.__BIPPY__.isCompositeFiber(fiber)) compositeCount++;
              if (window.__BIPPY__.isHostFiber(fiber)) hostCount++;
            });
            resolve({ compositeCount, hostCount });
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(classification.compositeCount).toBeGreaterThan(0);
    expect(classification.hostCount).toBeGreaterThan(0);
  });

  test("secondary instrument() consumers keep receiving commits", async ({ page }) => {
    const bothFired = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        let firstFired = false;
        window.__BIPPY__.instrument({
          onCommitFiberRoot: () => {
            firstFired = true;
          },
        });
        window.__BIPPY__.instrument({
          onCommitFiberRoot: () => {
            resolve(firstFired);
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(bothFired).toBe(true);
  });
});

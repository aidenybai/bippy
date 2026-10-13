// Runs only in the profiling project of the production config: a
// production-grade React build with profiling timers enabled through the
// react-dom/profiling alias. Profiling fibers carry actualDuration and
// actualStartTime, which exercises bippy's timing-based double-buffer
// resolution in getLatestFiber.
import { expect, test } from "@playwright/test";

import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("profiling build", () => {
  test("reports as a production build", async ({ page }) => {
    const buildType = await page.evaluate(() => {
      const renderers = [...window.__BIPPY__._renderers];
      if (renderers.length === 0) return "no-renderer";
      return window.__BIPPY__.detectReactBuildType(renderers[0]);
    });
    expect(buildType).toBe("production");
  });

  test("fibers carry profiling timings after an update", async ({ page }) => {
    const timings = await page.evaluate(() => {
      return new Promise<{ hasStartTime: boolean; hasDuration: boolean }>((resolve) => {
        window.__BIPPY__.instrument({
          onCommitFiberRoot: (_rendererID, root) => {
            let hasStartTime = false;
            let hasDuration = false;
            window.__BIPPY__.traverseFiber(root.current, (fiber) => {
              if (typeof fiber.actualStartTime === "number" && fiber.actualStartTime > 0) {
                hasStartTime = true;
              }
              if (typeof fiber.actualDuration === "number") {
                hasDuration = true;
              }
            });
            resolve({ hasStartTime, hasDuration });
          },
        });
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
      });
    });
    expect(timings).toEqual({ hasStartTime: true, hasDuration: true });
  });

  test("getLatestFiber resolves double-buffered fibers using profiling timestamps", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const clickIncrement = () =>
        new Promise<void>((resolve) => {
          window.__BIPPY__.instrument({
            onCommitFiberRoot: () => resolve(),
          });
          document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
        });

      // Two commits guarantee an alternate pair exists.
      await clickIncrement();
      await clickIncrement();

      const hostElement = document.querySelector('[data-testid="increment"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(hostElement);
      if (!fiber) return null;

      const compositeFiber = window.__BIPPY__.traverseFiber(
        fiber,
        (candidate) => window.__BIPPY__.isCompositeFiber(candidate),
        true,
      );
      if (!compositeFiber) return null;

      const latestFiber = window.__BIPPY__.getLatestFiber(compositeFiber);
      const alternateLatest = compositeFiber.alternate
        ? window.__BIPPY__.getLatestFiber(compositeFiber.alternate)
        : latestFiber;
      return {
        hasAlternate: compositeFiber.alternate !== null,
        // Both buffer halves must resolve to the same latest fiber.
        resolvesConsistently: latestFiber === alternateLatest,
        latestRendered: latestFiber.memoizedProps !== null,
      };
    });
    expect(result).toEqual({
      hasAlternate: true,
      resolvesConsistently: true,
      latestRendered: true,
    });
  });

  test("commits keep flowing across multiple updates", async ({ page }) => {
    const commitCount = await page.evaluate(async () => {
      let observedCommits = 0;
      window.__BIPPY__.instrument({
        onCommitFiberRoot: () => {
          observedCommits++;
        },
      });
      for (let clickIndex = 0; clickIndex < 3; clickIndex++) {
        document.querySelector<HTMLElement>('[data-testid="increment"]')!.click();
        await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      }
      await new Promise((resolveTick) => setTimeout(resolveTick, 100));
      return observedCommits;
    });
    expect(commitCount).toBeGreaterThanOrEqual(3);
  });
});

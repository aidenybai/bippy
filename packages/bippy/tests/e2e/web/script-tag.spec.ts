// No-bundler integration: React 18 UMD builds loaded through classic
// script tags with bippy installed by a preceding IIFE script, the way
// legacy apps bolt tools onto the page. Runs in the production config.
import { expect, test, type Page } from "@playwright/test";

const waitForApp = async (page: Page, pagePath: string) => {
  await page.goto(pagePath);
  await page.waitForSelector('[data-testid="increment"]', { timeout: 15_000 });
};

const expectCommitsOnClick = async (page: Page) => {
  const commitCountBefore = await page.evaluate(() => window.__COMMIT_COUNT__);
  await page.getByTestId("increment").click();
  await expect(page.getByTestId("increment")).toHaveText("count:1");
  expect(await page.evaluate(() => window.__COMMIT_COUNT__)).toBeGreaterThan(commitCountBefore);
};

test.describe("script-tag React 18 development UMD", () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page, "/index.html");
  });

  test("bippy installs before React and activates", async ({ page }) => {
    const status = await page.evaluate(() => ({
      isActive: window.__BIPPY__.isInstrumentationActive(),
      rendererCount: window.__BIPPY__._renderers.size,
      buildType: window.__BIPPY__.detectReactBuildType([...window.__BIPPY__._renderers][0]),
      reactVersion: [...window.__BIPPY__._renderers][0]?.version ?? null,
    }));
    expect(status.isActive).toBe(true);
    expect(status.rendererCount).toBe(1);
    expect(status.buildType).toBe("development");
    expect(String(status.reactVersion)).toContain("18.");
  });

  test("commits are observed on interaction", async ({ page }) => {
    await expectCommitsOnClick(page);
  });

  test("getFiberFromHostInstance resolves host fibers", async ({ page }) => {
    const isHostFiber = await page.evaluate(() => {
      const hostElement = document.querySelector('[data-testid="increment"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(hostElement);
      return fiber ? window.__BIPPY__.isHostFiber(fiber) : null;
    });
    expect(isHostFiber).toBe(true);
  });
});

test.describe("script-tag React 18 production UMD", () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page, "/prod.html");
  });

  test("bippy activates against the minified renderer", async ({ page }) => {
    const status = await page.evaluate(() => ({
      isActive: window.__BIPPY__.isInstrumentationActive(),
      buildType: window.__BIPPY__.detectReactBuildType([...window.__BIPPY__._renderers][0]),
    }));
    expect(status.isActive).toBe(true);
    expect(status.buildType).toBe("production");
  });

  test("commits are observed on interaction", async ({ page }) => {
    await expectCommitsOnClick(page);
  });

  test("work tag classification holds on the minified build", async ({ page }) => {
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
});

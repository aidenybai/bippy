// Regression coverage for bippy#97: on a Vite/Next dev page, react-refresh
// installs a stub hook whose inject() never records renderers, React
// injects into it, the app renders, and only then does bippy load. bippy
// must still activate and keep observing commits.
import { expect, test } from "@playwright/test";

test.describe("bippy loading after React on a react-refresh page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/late.html");
    await page.waitForFunction(() => window.__LATE_LOAD_RESULT__ !== undefined, undefined, {
      timeout: 15_000,
    });
  });

  test("activates immediately without waiting for a commit", async ({ page }) => {
    const result = await page.evaluate(() => window.__LATE_LOAD_RESULT__!);
    expect(result.onActiveFired).toBe(true);
    expect(result.isInstrumentationActive).toBe(true);
  });

  test("observes onCommitFiberRoot for updates after the late load", async ({ page }) => {
    const result = await page.evaluate(() => window.__LATE_LOAD_RESULT__!);
    expect(result.commitObservedAfterUpdate).toBe(true);
  });

  test("keeps working for further interactions", async ({ page }) => {
    const commitObserved = await page.evaluate(async () => {
      let observed = false;
      window.__BIPPY__.instrument({
        onCommitFiberRoot: () => {
          observed = true;
        },
      });
      document.querySelector<HTMLButtonElement>('[data-testid="late-increment"]')!.click();
      await new Promise((resolveTick) => setTimeout(resolveTick, 100));
      return observed;
    });
    expect(commitObserved).toBe(true);

    await expect(page.getByTestId("late-increment")).toHaveText("count:2");
  });
});

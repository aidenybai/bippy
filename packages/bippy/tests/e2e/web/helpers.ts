import type { Page } from "@playwright/test";

export const waitForBippy = async (page: Page) => {
  await page.waitForFunction(() => typeof window.__BIPPY__ !== "undefined", undefined, {
    timeout: 10_000,
  });
};

export const waitForTestChild = async (page: Page) => {
  await page.waitForSelector('[data-testid="test-child"]', { timeout: 10_000 });
};

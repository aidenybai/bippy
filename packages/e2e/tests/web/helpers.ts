import type { Page } from "@playwright/test";

export const waitForBippy = async (page: Page) => {
  await page.waitForFunction(() => typeof window.__BIPPY__ !== "undefined", undefined, {
    timeout: 10_000,
  });
};

export const waitForTestChild = async (page: Page) => {
  await page.waitForSelector('[data-testid="test-child"]', { timeout: 10_000 });
};

export const getHostFiber = async (page: Page, testId: string) => {
  return page.evaluate((selector) => {
    const element = document.querySelector(`[data-testid="${selector}"]`);
    if (!element) return null;
    const fiber = window.__BIPPY__.getFiberFromHostInstance(element);
    if (!fiber) return null;
    return {
      tag: fiber.tag,
      type: typeof fiber.type === "string" ? fiber.type : null,
    };
  }, testId);
};

export const findCompositeFiberByName = async (page: Page, componentName: string) => {
  return page.evaluate((name) => {
    const rootElement = document.getElementById("root") ?? document.querySelector("#__next");
    if (!rootElement) return false;
    const rootFiber = window.__BIPPY__.getFiberFromHostInstance(rootElement);
    if (!rootFiber) return false;

    let found = false;
    window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
      if (window.__BIPPY__.getDisplayName(fiber.type) === name) {
        found = true;
        return true;
      }
    });
    return found;
  }, componentName);
};

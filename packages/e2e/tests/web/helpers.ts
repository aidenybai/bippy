import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __BIPPY_HMR__?: {
      refreshUpdates: {
        areUpdatedFibersValid: boolean;
        filePaths: string[];
        staleFiberNames: (string | null)[];
        staleNames: (string | null)[];
        updatedFiberNames: (string | null)[];
        updatedNames: (string | null)[];
        updatedSourceFileNames: (string | null)[];
      }[];
      hasRefreshListener: boolean;
      secondListenerUpdatedNames: string[];
      installSecondListener: () => boolean;
      disposeSecondListener: () => void;
    };
  }
}

export const waitForBippy = async (page: Page) => {
  await page.waitForFunction(() => typeof window.__BIPPY__ !== "undefined", undefined, {
    timeout: 10_000,
  });
};

export const waitForTestChild = async (page: Page) => {
  await page.waitForSelector('[data-testid="test-child"]', { timeout: 10_000 });
};

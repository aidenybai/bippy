import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test as base } from "@playwright/test";

const rawDir = resolve(import.meta.dirname, "../../.coverage-v8");

export const test = base.extend<{ coverageCapture: void }>({
  coverageCapture: [
    async ({ page }, use) => {
      if (!process.env.COVERAGE || !page.coverage) {
        await use();
        return;
      }
      let started = false;
      try {
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        started = true;
      } catch {}
      try {
        await use();
      } finally {
        if (started) {
          try {
            const entries = await page.coverage.stopJSCoverage();
            if (entries.length > 0) {
              mkdirSync(rawDir, { recursive: true });
              writeFileSync(join(rawDir, `${randomUUID()}.json`), JSON.stringify(entries));
            }
          } catch {}
        }
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";

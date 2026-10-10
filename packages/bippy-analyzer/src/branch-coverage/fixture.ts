import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface V8CoverageEntry {
  url: string;
  source?: string;
  scriptId?: string;
  functions?: unknown[];
}

export interface CoveragePage {
  coverage?: {
    startJSCoverage: (options?: { resetOnNavigation?: boolean }) => Promise<void>;
    stopJSCoverage: () => Promise<V8CoverageEntry[]>;
  };
}

export const cleanRawCoverage = (rawDir: string): void => {
  rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
};

export const writeRawCoverage = (rawDir: string, entries: V8CoverageEntry[]): void => {
  if (!Array.isArray(entries) || entries.length === 0) return;
  try {
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, `${randomUUID()}.json`), JSON.stringify(entries));
  } catch {
    // Best-effort: coverage must never fail a real test.
  }
};

/** Per-test Playwright Chromium V8 capture. Best-effort; no-ops without page.coverage. */
export const capturePlaywrightCoverage = async (
  page: CoveragePage,
  rawDir: string,
  use: () => Promise<void>,
): Promise<void> => {
  let started = false;
  if (page.coverage) {
    try {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      started = true;
    } catch {
      started = false;
    }
  }

  try {
    await use();
  } finally {
    if (started && page.coverage) {
      try {
        writeRawCoverage(rawDir, await page.coverage.stopJSCoverage());
      } catch {
        // ignore: coverage is best-effort
      }
    }
  }
};

import { chromium } from "@playwright/test";
import type { FiberSnapshot } from "../snapshot/types.js";

export interface RuntimeCapture {
  roots: FiberSnapshot[];
  commitCount: number;
  /** `console.error` output and uncaught page errors, for the report. */
  pageErrors: string[];
}

export interface CaptureOptions {
  /** Path of the bundled `capture.ts`. */
  captureScriptPath: string;
  /** Milliseconds to wait for React's first commit. */
  firstCommitTimeoutMs: number;
  /** Milliseconds without a new commit before the tree counts as settled. */
  settleMs: number;
  /** Upper bound on waiting for the tree to settle. */
  maxSettleMs: number;
}

const SETTLE_POLL_MS = 250;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Opens `url` in headless Chromium with the capture script installed before
 * any page script runs, waits for React to commit and go quiet, and returns
 * the committed fiber trees.
 */
export const captureRuntimeTree = async (
  url: string,
  options: CaptureOptions,
): Promise<RuntimeCapture> => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(`console.error: ${message.text()}`);
    });
    await page.addInitScript({ path: options.captureScriptPath });
    await page.goto(url, { waitUntil: "load", timeout: options.firstCommitTimeoutMs });
    await page.waitForFunction(() => window.__BIPPY_PARSER_CAPTURE__.getCommitCount() > 0, null, {
      timeout: options.firstCommitTimeoutMs,
    });

    const settleDeadline = Date.now() + options.maxSettleMs;
    let commitCount = await page.evaluate(() => window.__BIPPY_PARSER_CAPTURE__.getCommitCount());
    let quietSince = Date.now();
    while (Date.now() < settleDeadline && Date.now() - quietSince < options.settleMs) {
      await sleep(SETTLE_POLL_MS);
      const latest = await page.evaluate(() => window.__BIPPY_PARSER_CAPTURE__.getCommitCount());
      if (latest !== commitCount) {
        commitCount = latest;
        quietSince = Date.now();
      }
    }

    const roots = await page.evaluate(() => window.__BIPPY_PARSER_CAPTURE__.snapshot());
    return { roots, commitCount, pageErrors };
  } finally {
    await browser.close();
  }
};

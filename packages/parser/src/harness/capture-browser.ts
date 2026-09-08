import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, stop as stopEsbuild } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { BundleError, HarnessInjectionError } from "../errors.js";
import { DEFAULT_SETTLE_MS } from "../evaluate/timers.js";
import { readObservationsJson } from "../observations.js";
import { readPackageManifest } from "../package-manifest.js";
import type { RuntimeObservations } from "../types.js";
import type { HarnessGlobals } from "./browser-inject.js";
import { parseSnapshot, type RuntimeSnapshot } from "./snapshot.js";

export interface BrowserCaptureOptions {
  url: string;
  waitForSelector?: string;
  settleMs?: number;
  timeoutMs?: number;
  headless?: boolean;
  /** `window` properties to record once the page has settled (bootstrap payloads the server injects or the page fetches). */
  globals?: string[];
  onConsole?: (type: string, text: string) => void;
}

export interface BrowserCaptureResult {
  snapshot: RuntimeSnapshot;
  commits: number;
  pageErrors: string[];
  title: string;
  observations: RuntimeObservations;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const COMMIT_POLL_INTERVAL_MS = 100;

const harnessDirectory = dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);

let injectBundlePromise: Promise<string> | null = null;

const bippyPackageDirectory = (): string => dirname(requireFromHere.resolve("bippy/package.json"));

const bippySourceEntry = (): string => resolve(bippyPackageDirectory(), "src/index.ts");

const bippyVersion = (): string =>
  readPackageManifest(resolve(bippyPackageDirectory(), "package.json")).version ?? "0.0.0";

export const buildInjectBundle = (): Promise<string> => {
  injectBundlePromise ??= build({
    entryPoints: [resolve(harnessDirectory, "browser-inject.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    alias: { bippy: bippySourceEntry() },
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
      "process.env.VERSION": JSON.stringify(bippyVersion()),
    },
    logLevel: "silent",
  }).then((result) => {
    const [output] = result.outputFiles;
    if (!output) throw new BundleError("esbuild produced no output for browser-inject");
    return output.text;
  });
  return injectBundlePromise;
};

// Functions passed to page.evaluate are serialized, so they cannot close over
// module constants; the global names are spelled out inline.
const readCommitCount = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const globals: Partial<HarnessGlobals> = Object(globalThis);
    const read = globals.__BIPPY_PARSER_COMMITS__;
    return read ? read() : 0;
  });

// Playwright's structured serializer rejects deeply nested objects; the page
// serializes the snapshot to a string and Node parses it back.
const readSnapshot = async (page: Page): Promise<RuntimeSnapshot | null> => {
  const json = await page.evaluate(() => {
    const globals: Partial<HarnessGlobals> = Object(globalThis);
    const read = globals.__BIPPY_PARSER_SNAPSHOT__;
    return read ? JSON.stringify(read()) : null;
  });
  return json === null ? null : parseSnapshot(json);
};

const readObservations = async (page: Page, names: string[]): Promise<RuntimeObservations> => {
  const json = await page.evaluate(async (globalNames) => {
    const globals: Partial<HarnessGlobals> = Object(globalThis);
    const observed: RuntimeObservations = {
      queries: [],
      ...(await globals.__BIPPY_PARSER_OBSERVATIONS__?.()),
      globals: (await globals.__BIPPY_PARSER_GLOBALS__?.(globalNames)) ?? {},
      page: globals.__BIPPY_PARSER_PAGE__?.(),
    };
    return JSON.stringify(observed);
  }, names);
  return readObservationsJson(JSON.parse(json), `${page.url()} observations`);
};

const readDevServerOverlay = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const overlay = document.querySelector("vite-error-overlay, nextjs-portal");
    const text = overlay?.shadowRoot?.textContent ?? overlay?.textContent ?? null;
    return text?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// Waits until the commit counter stops moving for `settleMs`, so the snapshot
// reflects the tree after effects, lazy boundaries and data fetches settle.
const waitForQuietCommits = async (
  page: Page,
  settleMs: number,
  timeoutMs: number,
): Promise<number> => {
  const deadline = Date.now() + timeoutMs;
  let lastCount = await readCommitCount(page);
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(COMMIT_POLL_INTERVAL_MS);
    const count = await readCommitCount(page);
    if (count !== lastCount) {
      lastCount = count;
      quietSince = Date.now();
    } else if (count > 0 && Date.now() - quietSince >= settleMs) {
      return count;
    }
  }
  return lastCount;
};

export interface BrowserCapturerOptions {
  headless?: boolean;
}

export class BrowserCapturer {
  private browserPromise: Promise<Browser> | null = null;
  private readonly headless: boolean;

  constructor(options: BrowserCapturerOptions = {}) {
    this.headless = options.headless ?? true;
  }

  private browser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({ headless: this.headless });
    return this.browserPromise;
  }

  async capture(options: BrowserCaptureOptions): Promise<BrowserCaptureResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    const [browser, inject] = await Promise.all([this.browser(), buildInjectBundle()]);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageErrors: string[] = [];
    try {
      await context.addInitScript(inject);
      const page = await context.newPage();
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(message.text());
        options.onConsole?.(message.type(), message.text());
      });
      const response = await page.goto(options.url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      const requestHeaders = (await response?.request().allHeaders()) ?? null;
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: timeoutMs });
      }
      const commits = await waitForQuietCommits(page, settleMs, timeoutMs);
      const snapshot = await readSnapshot(page);
      if (!snapshot) throw new HarnessInjectionError(options.url);
      if (commits === 0) {
        const overlay = await readDevServerOverlay(page);
        if (overlay) pageErrors.push(overlay);
      }
      const observations = await readObservations(page, options.globals ?? []);
      if (requestHeaders) observations.request = { headers: requestHeaders };
      return { snapshot, commits, pageErrors, title: await page.title(), observations };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (injectBundlePromise) {
      injectBundlePromise = null;
      await stopEsbuild();
    }
    if (!this.browserPromise) return;
    const browser = await this.browserPromise;
    this.browserPromise = null;
    await browser.close();
  }
}

export const captureBrowserSnapshot = async (
  options: BrowserCaptureOptions,
): Promise<BrowserCaptureResult> => {
  const capturer = new BrowserCapturer({ headless: options.headless });
  try {
    return await capturer.capture(options);
  } finally {
    await capturer.close();
  }
};

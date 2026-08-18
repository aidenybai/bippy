// Fast Refresh e2e against a real `next dev` server: file edits on disk,
// with bippy installed through instrumentation-client.ts the way Next apps
// integrate it. Scenario semantics mirror Next.js' own Fast Refresh
// acceptance tests, rebuilt here as original fixtures.
import type { ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { getFreePort, spawnDevServer, stopDevServer, waitForServer } from "./server-utils";

const fixtureDirectory = path.resolve(import.meta.dirname, "../../../fixtures/next-hmr-app");
const targetFilePath = path.join(fixtureDirectory, "app/target.tsx");

const fixtureRequire = createRequire(path.join(fixtureDirectory, "package.json"));
const nextBinPath = path.join(
  path.dirname(fixtureRequire.resolve("next/package.json")),
  "dist/bin/next",
);

const nextCounterSource = (version: string): string => `"use client";

// Overwritten by tests/web/hmr/next-hmr.spec.ts at runtime and restored
// afterwards. Keep in sync with nextCounterSource("v1") in that spec.
import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setCount(count + 1)}>
      ${version}:{count}
    </button>
  );
};
`;

const nextExtraHookSource = (version: string): string => `"use client";

import { useState } from "react";

export const Target = () => {
  const [label] = useState("extra");
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="${version}" onClick={() => setCount(count + 1)}>
      ${version}:{count}:{label}
    </button>
  );
};
`;

const nextSyntaxErrorSource = `"use client";

import { useState } from "react";

export const Target = () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="target" data-version="broken" onClick={() => setCount(count + 1)}>
      {count
    </button>
  );
};
`;

let nextProcess: ChildProcess | null = null;
let baseUrl = "";

const writeTarget = (source: string): void => {
  writeFileSync(targetFilePath, source);
};

const writeInitialTarget = async (source: string): Promise<void> => {
  writeTarget(source);
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
};

const openApp = async (page: Page): Promise<void> => {
  await page.goto(baseUrl);
  await page.waitForFunction(() => window.__BIPPY_PROBE_READY__ === true, undefined, {
    timeout: 60_000,
  });
  await page.waitForSelector('[data-testid="target"]', { timeout: 60_000 });
};

const applyEditAndWaitForVersion = async (
  page: Page,
  source: string,
  version: string,
): Promise<void> => {
  writeTarget(source);
  try {
    await page.waitForSelector(`[data-testid="target"][data-version="${version}"]`, {
      timeout: 15_000,
    });
  } catch {
    // Nudge the watcher once if the update was dropped.
    writeTarget(source);
    await page.waitForSelector(`[data-testid="target"][data-version="${version}"]`, {
      timeout: 30_000,
    });
  }
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  writeTarget(nextCounterSource("v1"));
  const port = await getFreePort();
  baseUrl = `http://localhost:${port}/`;
  nextProcess = spawnDevServer(
    process.execPath,
    [nextBinPath, "dev", "--port", String(port)],
    fixtureDirectory,
    { NODE_OPTIONS: "--localstorage-file=/tmp/bippy-e2e-next-hmr-localstorage.json" },
  );
  await waitForServer(baseUrl, 120_000);
});

test.afterAll(async () => {
  stopDevServer(nextProcess);
  writeTarget(nextCounterSource("v1"));
});

test.describe("Fast Refresh through a real next dev server", () => {
  test("an edit updates output while preserving state, and bippy observes the refresh commit", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await writeInitialTarget(nextCounterSource("v1"));
    await openApp(page);

    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    const commitCountBeforeEdit = await page.evaluate(() => window.__COMMIT_COUNT__);
    await applyEditAndWaitForVersion(page, nextCounterSource("v2"), "v2");

    await expect(page.getByTestId("target")).toHaveText("v2:1");
    expect(await page.evaluate(() => window.__COMMIT_COUNT__)).toBeGreaterThan(
      commitCountBeforeEdit,
    );
    expect(await page.evaluate(() => window.__BIPPY__.isInstrumentationActive())).toBe(true);
  });

  test("changing the hook order remounts with fresh state", async ({ page }) => {
    test.setTimeout(180_000);
    await writeInitialTarget(nextCounterSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    await applyEditAndWaitForVersion(page, nextExtraHookSource("v2"), "v2");
    await expect(page.getByTestId("target")).toHaveText("v2:0:extra");
  });

  test("recovers from a syntax error and bippy stays instrumented", async ({ page }) => {
    test.setTimeout(180_000);
    await writeInitialTarget(nextCounterSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    writeTarget(nextSyntaxErrorSource);
    // Next renders build errors inside the nextjs-portal shadow root, so
    // the host element itself never becomes "visible" to Playwright.
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("nextjs-portal")).some(
          (portalHost) => (portalHost.shadowRoot?.childElementCount ?? 0) > 0,
        ),
      undefined,
      { timeout: 30_000 },
    );

    await applyEditAndWaitForVersion(page, nextCounterSource("v2"), "v2");
    await expect(page.getByTestId("target")).toHaveText("v2:1");
    expect(await page.evaluate(() => window.__BIPPY__.isInstrumentationActive())).toBe(true);

    const commitCountBeforeClick = await page.evaluate(() => window.__COMMIT_COUNT__);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v2:2");
    expect(await page.evaluate(() => window.__COMMIT_COUNT__)).toBeGreaterThan(
      commitCountBeforeClick,
    );
  });
});

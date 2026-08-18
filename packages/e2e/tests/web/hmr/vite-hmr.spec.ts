// Real Fast Refresh e2e: a live `vite dev` server with @vitejs/plugin-react,
// file edits on disk, and assertions that both React's refresh semantics and
// bippy's instrumentation survive every update. Scenario semantics follow
// facebook/react's ReactFreshIntegration-test.js (MIT licensed, Copyright (c)
// Meta Platforms, Inc. and affiliates) exercised through a real bundler.
import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  classComponentSource,
  counterSource,
  customHookSource,
  effectLoggingSource,
  extraHookSource,
  INITIAL_TARGET_SOURCE,
  refreshResetSource,
  renamedStateVariableSource,
  syntaxErrorSource,
} from "./target-sources";

const fixtureDirectory = path.resolve(import.meta.dirname, "../../../fixtures/hmr-app");
const targetFilePath = path.join(fixtureDirectory, "src/target.tsx");

// The workspace uses the hoisted node linker, so vite may live in the root
// node_modules rather than the fixture's; resolve it like node would.
const fixtureRequire = createRequire(path.join(fixtureDirectory, "package.json"));
const viteBinPath = path.join(
  path.dirname(fixtureRequire.resolve("vite/package.json")),
  "bin/vite.js",
);

let viteProcess: ChildProcess | null = null;
let baseUrl = "";

const getFreePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probeServer = createServer();
    probeServer.once("error", reject);
    probeServer.listen(0, "127.0.0.1", () => {
      const address = probeServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not determine a free port"));
        return;
      }
      probeServer.close(() => resolve(address.port));
    });
  });

const waitForServer = async (url: string): Promise<void> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 200));
  }
  throw new Error(`vite dev server did not become ready at ${url}`);
};

const writeTarget = (source: string): void => {
  writeFileSync(targetFilePath, source);
};

// Writing the initial source immediately before page.goto races the file
// watcher: the page can load the new module and then still receive an HMR
// update for the same write, refreshing once more than the test expects.
// Letting the watcher fire while no client is connected avoids that.
const writeInitialTarget = async (source: string): Promise<void> => {
  writeTarget(source);
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 400));
};

const openApp = async (page: Page): Promise<void> => {
  await page.goto(baseUrl);
  await page.waitForFunction(() => typeof window.__BIPPY__ !== "undefined", undefined, {
    timeout: 15_000,
  });
  await page.waitForSelector('[data-testid="target"]', { timeout: 15_000 });
};

const waitForVersion = async (page: Page, version: string): Promise<void> => {
  await page.waitForSelector(`[data-testid="target"][data-version="${version}"]`, {
    timeout: 15_000,
  });
};

// File watchers occasionally drop rapid successive writes (especially right
// after an error state). If no update landed after a generous window,
// rewrite the same content once to nudge the watcher; since the content is
// identical, a genuine but slow first update cannot double-apply semantics.
const applyEditAndWaitForVersion = async (
  page: Page,
  source: string,
  version: string,
): Promise<void> => {
  writeTarget(source);
  try {
    await page.waitForSelector(`[data-testid="target"][data-version="${version}"]`, {
      timeout: 10_000,
    });
  } catch {
    writeTarget(source);
    await waitForVersion(page, version);
  }
};

const getCommitCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__COMMIT_COUNT__);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  writeTarget(INITIAL_TARGET_SOURCE);
  const port = await getFreePort();
  baseUrl = `http://localhost:${port}/`;
  viteProcess = spawn(process.execPath, [viteBinPath, "--port", String(port), "--strictPort"], {
    cwd: fixtureDirectory,
    stdio: "ignore",
  });
  await waitForServer(baseUrl);
});

test.afterAll(async () => {
  viteProcess?.kill("SIGTERM");
  writeTarget(INITIAL_TARGET_SOURCE);
});

test.describe("Fast Refresh through a real vite dev server", () => {
  test("an edit updates output while preserving state, and bippy observes the refresh commit", async ({
    page,
  }) => {
    await writeInitialTarget(counterSource("v1"));
    await openApp(page);

    await page.getByTestId("target").click();
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:2");

    const commitCountBeforeEdit = await getCommitCount(page);
    await applyEditAndWaitForVersion(page, counterSource("v2"), "v2");

    // State survived the refresh; output re-rendered from the new module.
    await expect(page.getByTestId("target")).toHaveText("v2:2");
    expect(await getCommitCount(page)).toBeGreaterThan(commitCountBeforeEdit);
    expect(await page.evaluate(() => window.__BIPPY__.isInstrumentationActive())).toBe(true);
  });

  test("edits reset effects while preserving state", async ({ page }) => {
    await writeInitialTarget(effectLoggingSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");
    const initialEffectLog = await page.evaluate(() => {
      const logEntries = [...window.__HMR_EFFECT_LOG__];
      window.__HMR_EFFECT_LOG__.length = 0;
      return logEntries;
    });
    expect(initialEffectLog).toEqual(["mount v1"]);

    await applyEditAndWaitForVersion(page, effectLoggingSource("v2"), "v2");

    // State survived, but the [] effect was cleaned up and re-ran.
    await expect(page.getByTestId("target")).toHaveText("v2:1");
    const effectLog = await page.evaluate(() => window.__HMR_EFFECT_LOG__);
    expect(effectLog).toEqual(["unmount v1", "mount v2"]);
  });

  test("renaming a state variable resets state", async ({ page }) => {
    await writeInitialTarget(counterSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    // The refresh signature includes useState variable names, so the
    // rename forces a remount with fresh state.
    await applyEditAndWaitForVersion(page, renamedStateVariableSource("v2"), "v2");
    await expect(page.getByTestId("target")).toHaveText("v2:0");
  });

  test("changing the hook order remounts with fresh state", async ({ page }) => {
    await writeInitialTarget(counterSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    await applyEditAndWaitForVersion(page, extraHookSource("v2"), "v2");
    await expect(page.getByTestId("target")).toHaveText("v2:0:extra");
  });

  test("reordering hooks inside a custom hook remounts its consumers", async ({ page }) => {
    await writeInitialTarget(customHookSource("v1", false));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    await applyEditAndWaitForVersion(page, customHookSource("v2", true), "v2");
    await expect(page.getByTestId("target")).toHaveText("v2:0");
  });

  test("the @refresh reset directive forces a remount on every edit", async ({ page }) => {
    await writeInitialTarget(refreshResetSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    await applyEditAndWaitForVersion(page, refreshResetSource("v2"), "v2");
    await expect(page.getByTestId("target")).toHaveText("v2:0");
  });

  test("switching the export from function to class remounts, and back", async ({ page }) => {
    // @vitejs/plugin-react registers compile-time function components under
    // "<file> <name>" but runtime exports under "<file> export <name>", and
    // classes are only registered through the runtime path. A function ->
    // class switch therefore never updates the mounted family: no refresh,
    // no reload, the UI silently stays on the old version. Expected to fail
    // until plugin-react bridges the two registration namespaces.
    test.fail(
      true,
      "vite-plugin-react cannot Fast Refresh a function -> class export switch; the UI stays stale",
    );
    await writeInitialTarget(counterSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    await applyEditAndWaitForVersion(page, classComponentSource("v2"), "v2");
    await expect(page.getByTestId("target")).toHaveText("v2:0");

    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v2:1");

    await applyEditAndWaitForVersion(page, counterSource("v3"), "v3");
    await expect(page.getByTestId("target")).toHaveText("v3:0");
  });

  test("recovers from a syntax error and bippy stays instrumented", async ({ page }) => {
    await writeInitialTarget(counterSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v1:1");

    writeTarget(syntaxErrorSource);
    await page.waitForSelector("vite-error-overlay", { timeout: 15_000 });

    await applyEditAndWaitForVersion(page, counterSource("v2"), "v2");

    // vite recovers via HMR after the module parses again; state survives
    // because the error never replaced the component tree.
    await expect(page.getByTestId("target")).toHaveText("v2:1");
    expect(await page.evaluate(() => window.__BIPPY__.isInstrumentationActive())).toBe(true);

    const commitCountBeforeClick = await getCommitCount(page);
    await page.getByTestId("target").click();
    await expect(page.getByTestId("target")).toHaveText("v2:2");
    expect(await getCommitCount(page)).toBeGreaterThan(commitCountBeforeClick);
  });

  test("getFiberFromHostInstance resolves fibers across refreshes", async ({ page }) => {
    await writeInitialTarget(counterSource("v1"));
    await openApp(page);

    const fiberTypeBeforeEdit = await page.evaluate(() => {
      const targetElement = document.querySelector('[data-testid="target"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(targetElement);
      return fiber ? String(fiber.type) : null;
    });
    expect(fiberTypeBeforeEdit).toBe("button");

    await applyEditAndWaitForVersion(page, counterSource("v2"), "v2");

    const fiberInfoAfterEdit = await page.evaluate(() => {
      const targetElement = document.querySelector('[data-testid="target"]');
      const fiber = window.__BIPPY__.getFiberFromHostInstance(targetElement);
      if (!fiber) return null;
      const latestFiber = window.__BIPPY__.getLatestFiber(fiber);
      return {
        type: String(fiber.type),
        isHostFiber: window.__BIPPY__.isHostFiber(latestFiber),
        stateNodeMatches: latestFiber.stateNode === targetElement,
      };
    });
    expect(fiberInfoAfterEdit).toEqual({
      type: "button",
      isHostFiber: true,
      stateNodeMatches: true,
    });
  });

  test("root commit tracking survives many sequential refreshes", async ({ page }) => {
    await writeInitialTarget(counterSource("v1"));
    await openApp(page);
    await page.getByTestId("target").click();

    for (let editIndex = 2; editIndex <= 6; editIndex++) {
      const version = `v${editIndex}`;
      const commitCountBeforeEdit = await getCommitCount(page);
      await applyEditAndWaitForVersion(page, counterSource(version), version);
      expect(await getCommitCount(page)).toBeGreaterThan(commitCountBeforeEdit);
    }

    // State survived all five refreshes and the root is still tracked
    // (regression guard for the #97 root commit tracking bug).
    await expect(page.getByTestId("target")).toHaveText("v6:1");
    const rootTracking = await page.evaluate(() => ({
      fiberRootCount: window.__BIPPY__._fiberRoots.size,
      isActive: window.__BIPPY__.isInstrumentationActive(),
    }));
    expect(rootTracking).toEqual({ fiberRootCount: 1, isActive: true });
  });
});

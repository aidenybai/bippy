import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { by, element, expect, waitFor } from "detox";

import { launchFixtureApp, readElementText } from "./helpers";

const HMR_TARGET_FILE_PATH = path.resolve(__dirname, "../../fixtures/expo-app/src/hmr-target.tsx");

const HMR_MARKER_REGEX = /hmr-marker-[\w-]+/;
const REFRESH_UPDATE_TIMEOUT_MS = 30_000;
const MARKER_APPLY_TIMEOUT_MS = 240_000;
// long enough for a watchman recrawl of the monorepo to complete between
// rewrites, short enough for several rewrite attempts within the window
const SAVE_RETRY_INTERVAL_MS = 20_000;
const REFRESH_TEST_TIMEOUT_MS = 400_000;

const readCurrentMarker = (source: string): string => {
  const markerMatch = source.match(HMR_MARKER_REGEX);
  if (!markerMatch) throw new Error("hmr-target fixture is missing an hmr-marker");
  return markerMatch[0];
};

// FSEvents silently drops file events on GitHub's virtualized macOS runners,
// which blinds every watcher backend built on it (node fs.watch AND
// watchman): CI metro logs show zero activity for minutes after a save.
// watchman debug-recrawl stat-scans the watched root and delivers the
// changed files to subscribers without relying on FSEvents at all. The CI
// workflow warms watchman up before Metro starts so Metro deterministically
// subscribes through watchman (instead of silently falling back to its
// FSEvents watcher, which this recovery cannot reach).
const recrawlWatchmanRoots = () => {
  if (!process.env.CI) return;
  try {
    const watchListOutput = execSync("watchman watch-list", { encoding: "utf8" });
    const watchedRoots: string[] = JSON.parse(watchListOutput).roots ?? [];
    console.log(`[refresh-spec] recrawling watchman roots: ${JSON.stringify(watchedRoots)}`);
    for (const watchedRoot of watchedRoots) {
      execSync(`watchman debug-recrawl ${JSON.stringify(watchedRoot)}`);
    }
  } catch (recrawlError) {
    console.log(`[refresh-spec] watchman recrawl failed: ${String(recrawlError)}`);
  }
};

const POLL_INTERVAL_MS = 1_000;

const readOptionalElementText = async (testId: string): Promise<string> => {
  try {
    return await readElementText(testId);
  } catch {
    return "<missing>";
  }
};

const waitForElementTextToContain = async (testId: string, expectedSubstring: string) => {
  const deadlineMs = Date.now() + REFRESH_UPDATE_TIMEOUT_MS;
  let lastText = "";
  while (Date.now() < deadlineMs) {
    try {
      lastText = await readElementText(testId);
      if (lastText.includes(expectedSubstring)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  const refreshCount = await readOptionalElementText("result-refresh-count");
  throw new Error(
    `expected ${testId} to contain "${expectedSubstring}", last saw "${lastText}" (refresh-count=${refreshCount})`,
  );
};

describe("bippy/react-refresh on React Native", () => {
  beforeAll(async () => {
    await launchFixtureApp(false, "result-refresh-listener");
  });

  it("installs a refresh listener through the devtools hook", async () => {
    await waitFor(element(by.id("result-refresh-listener")))
      .toExist()
      .withTimeout(REFRESH_UPDATE_TIMEOUT_MS);
    await expect(element(by.id("result-refresh-listener"))).toHaveText("true");
  });

  it(
    "reports the updated component, its fibers, and the file path after a save",
    async () => {
      const originalSource = readFileSync(HMR_TARGET_FILE_PATH, "utf8");
      const currentMarker = readCurrentMarker(originalSource);

      // a single HMR push can be lost while the client is still initializing,
      // and rewriting identical content is a no-op for Metro's incremental
      // build (same hash, no new push) - so every retry must write a FRESH
      // marker to force a new update, plus recrawl watchman since FSEvents
      // inside the macOS VM can drop the file event entirely
      const saveAndAwaitMarker = async (): Promise<void> => {
        const deadlineMs = Date.now() + MARKER_APPLY_TIMEOUT_MS;
        let lastText = "";
        while (Date.now() < deadlineMs) {
          const uniqueMarker = `hmr-marker-${Date.now()}`;
          writeFileSync(HMR_TARGET_FILE_PATH, originalSource.replace(currentMarker, uniqueMarker));
          recrawlWatchmanRoots();
          const retryAtMs = Math.min(Date.now() + SAVE_RETRY_INTERVAL_MS, deadlineMs);
          while (Date.now() < retryAtMs) {
            try {
              lastText = await readElementText("hmr-target-text");
              if (lastText === uniqueMarker) return;
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          }
        }
        const refreshCount = await readOptionalElementText("result-refresh-count");
        throw new Error(
          `hmr marker never applied, last saw "${lastText}" (refresh-count=${refreshCount})`,
        );
      };

      try {
        await saveAndAwaitMarker();

        // a full reload (instead of an in-place fast refresh) also applies the
        // marker but never fires scheduleRefresh; refresh-count distinguishes
        // the two when the update rows below come up empty
        await waitForElementTextToContain("result-refresh-last-update", "HmrTarget");
        await waitForElementTextToContain("result-refresh-last-fibers", "HmrTarget");
        await expect(element(by.id("result-refresh-fibers-valid"))).toHaveText("true");

        // Metro reports extension-less paths (e.g. src/hmr-target); the exact
        // prefix depends on the metro server root, so match the file stem
        await waitForElementTextToContain("result-refresh-last-paths", "hmr-target");
      } finally {
        writeFileSync(HMR_TARGET_FILE_PATH, originalSource);
      }
    },
    REFRESH_TEST_TIMEOUT_MS,
  );
});

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { by, element, expect, waitFor } from "detox";

import { launchFixtureApp, readElementText } from "./helpers";

const HMR_TARGET_FILE_PATH = path.resolve(__dirname, "../../fixtures/expo-app/src/hmr-target.tsx");

const HMR_MARKER_REGEX = /hmr-marker-[\w-]+/;
const REFRESH_UPDATE_TIMEOUT_MS = 30_000;
// metro's file watcher on loaded CI VMs can take >80s to surface a save
// (measured from CI metro logs), so each attempt must outwait that latency
const MARKER_APPLY_TIMEOUT_MS = 150_000;
const SAVE_ATTEMPT_COUNT = 2;
const REFRESH_TEST_TIMEOUT_MS = 400_000;

const readCurrentMarker = (source: string): string => {
  const markerMatch = source.match(HMR_MARKER_REGEX);
  if (!markerMatch) throw new Error("hmr-target fixture is missing an hmr-marker");
  return markerMatch[0];
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

      // a save can rarely be lost entirely (missed watcher event), so one slow
      // retry remains as a safety net
      const saveAndAwaitMarker = async (): Promise<void> => {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < SAVE_ATTEMPT_COUNT; attempt++) {
          const uniqueMarker = `hmr-marker-${Date.now()}-${attempt}`;
          writeFileSync(HMR_TARGET_FILE_PATH, originalSource.replace(currentMarker, uniqueMarker));
          try {
            await waitFor(element(by.id("hmr-target-text")))
              .toHaveText(uniqueMarker)
              .withTimeout(MARKER_APPLY_TIMEOUT_MS);
            return;
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
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

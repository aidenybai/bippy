import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { by, device, element, expect, waitFor } from "detox";

const HMR_TARGET_FILE_PATH = path.resolve(__dirname, "../../fixtures/expo-app/src/hmr-target.tsx");

const HMR_MARKER_REGEX = /hmr-marker-[\w-]+/;
const REFRESH_UPDATE_TIMEOUT_MS = 30_000;

const readCurrentMarker = (source: string): string => {
  const markerMatch = source.match(HMR_MARKER_REGEX);
  if (!markerMatch) throw new Error("hmr-target fixture is missing an hmr-marker");
  return markerMatch[0];
};

const POLL_INTERVAL_MS = 1_000;

const readElementText = async (testId: string): Promise<string> => {
  const attributes = await element(by.id(testId)).getAttributes();
  return "text" in attributes && typeof attributes.text === "string" ? attributes.text : "";
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
  throw new Error(`expected ${testId} to contain "${expectedSubstring}", last saw "${lastText}"`);
};

describe("bippy/react-refresh on React Native", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id("results-container")))
      .toBeVisible()
      .withTimeout(15_000);
  });

  it("installs a refresh listener through the devtools hook", async () => {
    await waitFor(element(by.id("result-refresh-listener")))
      .toExist()
      .withTimeout(REFRESH_UPDATE_TIMEOUT_MS);
    await expect(element(by.id("result-refresh-listener"))).toHaveText("true");
  });

  it("reports the updated component, its fibers, and the file path after a save", async () => {
    const originalSource = readFileSync(HMR_TARGET_FILE_PATH, "utf8");
    const currentMarker = readCurrentMarker(originalSource);
    const uniqueMarker = `hmr-marker-${Date.now()}`;

    try {
      writeFileSync(HMR_TARGET_FILE_PATH, originalSource.replace(currentMarker, uniqueMarker));

      await waitFor(element(by.id("hmr-target-text")))
        .toHaveText(uniqueMarker)
        .withTimeout(REFRESH_UPDATE_TIMEOUT_MS);

      await waitFor(element(by.id("result-refresh-last-update")))
        .toHaveText("HmrTarget")
        .withTimeout(REFRESH_UPDATE_TIMEOUT_MS);
      await expect(element(by.id("result-refresh-last-fibers"))).toHaveText("HmrTarget");
      await expect(element(by.id("result-refresh-fibers-valid"))).toHaveText("true");

      // Metro reports extension-less paths (e.g. src/hmr-target); the exact
      // prefix depends on the metro server root, so match the file stem
      await waitForElementTextToContain("result-refresh-last-paths", "hmr-target");
    } finally {
      writeFileSync(HMR_TARGET_FILE_PATH, originalSource);
    }
  });
});

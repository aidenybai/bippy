import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionSourceResult } from "../../fixtures/chrome-extension/src/main.js";

test("symbolicates a minified component inside a Chrome extension", async () => {
  const extensionPath = resolve(import.meta.dirname, "../../fixtures/chrome-extension/dist");
  const extensionAssets = await readdir(resolve(extensionPath, "assets"));
  expect(extensionAssets.some((assetName) => assetName.endsWith(".js.map"))).toBe(true);
  const userDataDirectory = await mkdtemp(`${tmpdir()}/bippy-extension-`);
  const browserContext = await chromium.launchPersistentContext(userDataDirectory, {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: "chromium",
  });

  try {
    const serviceWorker =
      browserContext.serviceWorkers()[0] ??
      (await browserContext.waitForEvent("serviceworker", { timeout: 15_000 }));
    const extensionId = new URL(serviceWorker.url()).host;
    const extensionPage = await browserContext.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/index.html`);

    const resultElement = extensionPage.locator("#result");
    await expect(resultElement).not.toHaveText("pending", { timeout: 15_000 });
    const result: ExtensionSourceResult = JSON.parse(await resultElement.innerText());
    expect(result.fileName).toContain("src/main.tsx");
    expect(result.displayName).toBe("BookmarkSaveAction");
    const sourceRequests = result.sourceRequests;
    expect(sourceRequests).toHaveLength(2);
    expect(sourceRequests[0]).toMatch(/^chrome-extension:\/\/[^/]+\/assets\/main-.+\.js$/);
    expect(sourceRequests[1]).toBe(`${sourceRequests[0]}.map`);
  } finally {
    await browserContext.close();
    await rm(userDataDirectory, { recursive: true });
  }
});

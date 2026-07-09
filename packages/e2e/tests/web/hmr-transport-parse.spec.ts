import { expect, test } from "./coverage-test";
import { waitForHmrHarness, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForHmrHarness(page);
});

test.describe("parseViteUpdatePaths", () => {
  test("returns acceptedPaths of js-update entries only", async ({ page }) => {
    const result = await page.evaluate(() => {
      const parse = window.__BIPPY_HMR__!.hmr.parseViteUpdatePaths;
      return {
        single: parse(
          JSON.stringify({
            type: "update",
            updates: [{ type: "js-update", acceptedPath: "/src/app.tsx" }],
          }),
        ),
        multiple: parse(
          JSON.stringify({
            type: "update",
            updates: [
              { type: "js-update", acceptedPath: "/src/first.tsx" },
              { type: "js-update", acceptedPath: "/src/second.tsx" },
            ],
          }),
        ),
        mixed: parse(
          JSON.stringify({
            type: "update",
            updates: [
              { type: "css-update", acceptedPath: "/src/styles.css" },
              { type: "js-update", acceptedPath: "/src/app.tsx" },
            ],
          }),
        ),
      };
    });
    expect(result.single).toEqual(["/src/app.tsx"]);
    expect(result.multiple).toEqual(["/src/first.tsx", "/src/second.tsx"]);
    expect(result.mixed).toEqual(["/src/app.tsx"]);
  });

  test("returns empty for malformed message payloads", async ({ page }) => {
    const result = await page.evaluate(() => {
      const parse = window.__BIPPY_HMR__!.hmr.parseViteUpdatePaths;
      return {
        notJson: parse("this is { not json"),
        jsonNull: parse("null"),
        jsonNumber: parse("42"),
        jsonString: parse('"update"'),
        missingType: parse(JSON.stringify({ updates: [] })),
        fullReload: parse(JSON.stringify({ type: "full-reload", path: "*" })),
        connected: parse(JSON.stringify({ type: "connected" })),
        missingUpdates: parse(JSON.stringify({ type: "update" })),
        updatesNotArray: parse(JSON.stringify({ type: "update", updates: "nope" })),
      };
    });
    expect(result.notJson).toEqual([]);
    expect(result.jsonNull).toEqual([]);
    expect(result.jsonNumber).toEqual([]);
    expect(result.jsonString).toEqual([]);
    expect(result.missingType).toEqual([]);
    expect(result.fullReload).toEqual([]);
    expect(result.connected).toEqual([]);
    expect(result.missingUpdates).toEqual([]);
    expect(result.updatesNotArray).toEqual([]);
  });

  test("skips malformed update entries while keeping valid ones", async ({ page }) => {
    const result = await page.evaluate(() => {
      const parse = window.__BIPPY_HMR__!.hmr.parseViteUpdatePaths;
      return parse(
        JSON.stringify({
          type: "update",
          updates: [
            null,
            "not-an-object",
            42,
            { acceptedPath: "/src/missing-type.tsx" },
            { type: "css-update", acceptedPath: "/src/styles.css" },
            { type: "js-update" },
            { type: "js-update", acceptedPath: 123 },
            { type: "js-update", acceptedPath: "/src/valid.tsx" },
          ],
        }),
      );
    });
    expect(result).toEqual(["/src/valid.tsx"]);
  });

  test("returns empty for css-only update messages", async ({ page }) => {
    const result = await page.evaluate(() => {
      const parse = window.__BIPPY_HMR__!.hmr.parseViteUpdatePaths;
      return parse(
        JSON.stringify({
          type: "update",
          updates: [
            { type: "css-update", acceptedPath: "/src/a.css" },
            { type: "css-update", acceptedPath: "/src/b.css" },
          ],
        }),
      );
    });
    expect(result).toEqual([]);
  });
});

test.describe("createMetroHmrTransport", () => {
  test("returns null outside a React Native runtime", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY_HMR__!.hmr.createMetroHmrTransport(() => {});
    });
    expect(result).toBeNull();
  });
});

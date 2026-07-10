import type { Page } from "@playwright/test";

import { expect, test } from "./coverage-test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("getSourceMap", () => {
  test("returns null when the bundle has no sourceMappingURL", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const fetchFn = async () => new Response("const noMapHere = 1;", { status: 200 });
      return window.__BIPPY__.getSourceMap("http://localhost:9999/no-map.js", false, fetchFn);
    });
    expect(result).toBeNull();
  });

  test("returns null when the bundle or map response is not ok", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const bundleNotFound = await window.__BIPPY__.getSourceMap(
        "http://localhost:9999/missing.js",
        false,
        async () => new Response("nope", { status: 404 }),
      );
      const mapNotFound = await window.__BIPPY__.getSourceMap(
        "http://localhost:9999/bundle.js",
        false,
        async (url: string) =>
          url.endsWith(".map")
            ? new Response("nope", { status: 404 })
            : new Response("//# sourceMappingURL=bundle.js.map", { status: 200 }),
      );
      return { bundleNotFound, mapNotFound };
    });
    expect(result.bundleNotFound).toBeNull();
    expect(result.mapNotFound).toBeNull();
  });

  test("returns null when the source map JSON is malformed", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const fetchFn = async (url: string) =>
        url.endsWith(".map")
          ? new Response("this is { not json", { status: 200 })
          : new Response("//# sourceMappingURL=bad.js.map", { status: 200 });
      return window.__BIPPY__.getSourceMap("http://localhost:9999/bad.js", false, fetchFn);
    });
    expect(result).toBeNull();
  });

  test("returns null for non-fetchable inline data-uri source maps", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const fetchFn = async () =>
        new Response("//# sourceMappingURL=data:application/json;base64,e30=", { status: 200 });
      return window.__BIPPY__.getSourceMap("http://localhost:9999/inline.js", false, fetchFn);
    });
    expect(result).toBeNull();
  });

  test("resolves relative sourceMappingURLs and decodes standard maps", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const fetchedUrls: string[] = [];
      const mapJson = JSON.stringify({
        version: 3,
        file: "bundle.js",
        sources: ["original-source.tsx"],
        sourcesContent: ["const OriginalComponent = () => null;"],
        mappings: "AAAA",
        names: [],
      });
      const fetchFn = async (url: string) => {
        fetchedUrls.push(url);
        return url.endsWith(".map")
          ? new Response(mapJson, { status: 200 })
          : new Response("const bundled = 1;\n//# sourceMappingURL=bundle.js.map", {
              status: 200,
            });
      };
      const sourceMap = await window.__BIPPY__.getSourceMap(
        "http://localhost:9999/assets/bundle.js",
        false,
        fetchFn,
      );
      return {
        fetchedUrls,
        sources: sourceMap?.sources ?? null,
        firstMapping: sourceMap?.mappings?.[0]?.[0] ?? null,
      };
    });
    expect(result.fetchedUrls).toEqual([
      "http://localhost:9999/assets/bundle.js",
      "http://localhost:9999/assets/bundle.js.map",
    ]);
    expect(result.sources).toEqual(["original-source.tsx"]);
    expect(result.firstMapping).toEqual([0, 0, 0, 0]);
  });

  test("decodes index source maps by aggregating section sources", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const indexMapJson = JSON.stringify({
        version: 3,
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: { version: 3, sources: ["first-section.tsx"], mappings: "AAAA", names: [] },
          },
          {
            offset: { line: 10, column: 0 },
            map: { version: 3, sources: ["second-section.tsx"], mappings: "AAAA", names: [] },
          },
        ],
      });
      const fetchFn = async (url: string) =>
        url.endsWith(".map")
          ? new Response(indexMapJson, { status: 200 })
          : new Response("//# sourceMappingURL=indexed.js.map", { status: 200 });
      const sourceMap = await window.__BIPPY__.getSourceMap(
        "http://localhost:9999/indexed.js",
        false,
        fetchFn,
      );
      return {
        sources: sourceMap?.sources ?? null,
        sectionCount: sourceMap?.sections?.length ?? 0,
      };
    });
    expect(result.sources).toEqual(["first-section.tsx", "second-section.tsx"]);
    expect(result.sectionCount).toBe(2);
  });

  test("caches definitive no-map results but not transient failures", async ({ page }) => {
    const result = await page.evaluate(async () => {
      let noMapFetchCount = 0;
      const noMapFetchFn = async () => {
        noMapFetchCount++;
        return new Response("const noMap = 1;", { status: 200 });
      };
      const firstNoMap = await window.__BIPPY__.getSourceMap(
        "http://localhost:9999/cached-no-map.js",
        true,
        noMapFetchFn,
      );
      const secondNoMap = await window.__BIPPY__.getSourceMap(
        "http://localhost:9999/cached-no-map.js",
        true,
        noMapFetchFn,
      );

      let flakyCallCount = 0;
      const mapJson = JSON.stringify({
        version: 3,
        sources: ["recovered-source.tsx"],
        mappings: "AAAA",
        names: [],
      });
      const flakyFetchFn = async (url: string) => {
        flakyCallCount++;
        if (flakyCallCount === 1) throw new Error("simulated network failure");
        return url.endsWith(".map")
          ? new Response(mapJson, { status: 200 })
          : new Response("//# sourceMappingURL=flaky.js.map", { status: 200 });
      };
      const transientResult = await window.__BIPPY__.getSourceMap(
        "http://localhost:9999/flaky.js",
        true,
        flakyFetchFn,
      );
      const recoveredResult = await window.__BIPPY__.getSourceMap(
        "http://localhost:9999/flaky.js",
        true,
        flakyFetchFn,
      );

      return {
        firstNoMap,
        secondNoMap,
        noMapFetchCount,
        transientResult,
        recoveredSources: recoveredResult?.sources ?? null,
      };
    });
    expect(result.firstNoMap).toBeNull();
    expect(result.secondNoMap).toBeNull();
    expect(result.noMapFetchCount).toBe(1);
    expect(result.transientResult).toBeNull();
    expect(result.recoveredSources).toEqual(["recovered-source.tsx"]);
  });
});

test.describe("getSourceFromSourceMap", () => {
  test("resolves the last segment at or before the column", async ({ page }) => {
    const result = await page.evaluate(() => {
      const sourceMap = {
        version: 3,
        sources: ["a.tsx", "b.tsx"],
        mappings: [
          [
            [0, 0, 0, 0],
            [10, 1, 4, 2],
          ],
        ],
      };
      return {
        atStart: window.__BIPPY__.getSourceFromSourceMap(sourceMap, 1, 0),
        beforeSecondSegment: window.__BIPPY__.getSourceFromSourceMap(sourceMap, 1, 5),
        afterSecondSegment: window.__BIPPY__.getSourceFromSourceMap(sourceMap, 1, 15),
      };
    });
    expect(result.atStart).toEqual({
      fileName: "a.tsx",
      lineNumber: 1,
      columnNumber: 0,
      ignored: false,
    });
    expect(result.beforeSecondSegment).toEqual({
      fileName: "a.tsx",
      lineNumber: 1,
      columnNumber: 0,
      ignored: false,
    });
    expect(result.afterSecondSegment).toEqual({
      fileName: "b.tsx",
      lineNumber: 5,
      columnNumber: 2,
      ignored: false,
    });
  });

  test("returns null for unmappable positions", async ({ page }) => {
    const result = await page.evaluate(() => {
      const getSourceFromSourceMap = window.__BIPPY__.getSourceFromSourceMap;
      const baseMap = { version: 3, sources: ["a.tsx"] };
      return {
        lineOutOfRange: getSourceFromSourceMap({ ...baseMap, mappings: [[[0, 0, 0, 0]]] }, 2, 0),
        emptyLineMapping: getSourceFromSourceMap({ ...baseMap, mappings: [[]] }, 1, 0),
        shortSegment: getSourceFromSourceMap({ ...baseMap, mappings: [[[5]]] }, 1, 10),
        missingSource: getSourceFromSourceMap({ ...baseMap, mappings: [[[0, 5, 0, 0]]] }, 1, 0),
        columnBeforeFirstSegment: getSourceFromSourceMap(
          { ...baseMap, mappings: [[[8, 0, 0, 0]]] },
          1,
          3,
        ),
      };
    });
    expect(result.lineOutOfRange).toBeNull();
    expect(result.emptyLineMapping).toBeNull();
    expect(result.shortSegment).toBeNull();
    expect(result.missingSource).toBeNull();
    expect(result.columnBeforeFirstSegment).toBeNull();
  });

  test("resolves positions through index map sections with offsets", async ({ page }) => {
    const result = await page.evaluate(() => {
      const sectionedMap = {
        version: 3,
        sources: ["first.tsx", "second.tsx"],
        mappings: [],
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ["first.tsx"],
              mappings: [[], [[0, 0, 0, 0]]],
            },
          },
          {
            offset: { line: 10, column: 5 },
            map: {
              version: 3,
              sources: ["second.tsx"],
              mappings: [[[0, 0, 2, 3]]],
            },
          },
        ],
      };
      // section offsets are 0-based generated positions while queried stack
      // frame lines are 1-based, so line 2 lands on the first section's
      // mappings[1] and line 11 lands on the second section's offset line
      return {
        firstSection: window.__BIPPY__.getSourceFromSourceMap(sectionedMap, 2, 0),
        secondSection: window.__BIPPY__.getSourceFromSourceMap(sectionedMap, 11, 5),
        beyondSectionMappings: window.__BIPPY__.getSourceFromSourceMap(sectionedMap, 20, 0),
      };
    });
    expect(result.firstSection).toEqual({
      fileName: "first.tsx",
      lineNumber: 1,
      columnNumber: 0,
      ignored: false,
    });
    expect(result.secondSection).toEqual({
      fileName: "second.tsx",
      lineNumber: 3,
      columnNumber: 3,
      ignored: false,
    });
    expect(result.beyondSectionMappings).toBeNull();
  });
});

test.describe("getDisplayNameFromSource with fabricated source maps", () => {
  const getDisplayNameThroughFakePipeline = async (page: Page, componentDeclaration: string) => {
    return page.evaluate(async (declaration) => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const mapJson = JSON.stringify({
        version: 3,
        sources: ["fake-extracted-source.tsx"],
        sourcesContent: [declaration],
        mappings: Array(100_000).fill("AAAA").join(";"),
        names: [],
      });
      const fetchFn = async (url: string) =>
        url.endsWith("fake-pipeline.map")
          ? new Response(mapJson, { status: 200 })
          : new Response("//# sourceMappingURL=fake-pipeline.map", { status: 200 });

      return window.__BIPPY__.getDisplayNameFromSource(fiber, false, fetchFn);
    }, componentDeclaration);
  };

  test.describe("name extraction", () => {
    // next serves webpack-internal:// stack frame urls, which getSourceMap
    // rejects as unfetchable, so the extraction pipeline never runs there
    test.beforeEach(() => {
      test.skip(test.info().project.name === "nextjs");
    });

    test("extracts arrow function component names from sourcesContent", async ({ page }) => {
      const result = await getDisplayNameThroughFakePipeline(
        page,
        "const FakeExtractedArrowComponent = () => null;",
      );
      expect(result).toBe("FakeExtractedArrowComponent");
    });

    test("extracts function declaration component names from sourcesContent", async ({ page }) => {
      const result = await getDisplayNameThroughFakePipeline(
        page,
        "export function FakeExtractedFunctionComponent() { return null; }",
      );
      expect(result).toBe("FakeExtractedFunctionComponent");
    });

    test("extracts class component names from sourcesContent", async ({ page }) => {
      const result = await getDisplayNameThroughFakePipeline(
        page,
        "export class FakeExtractedClassComponent {}",
      );
      expect(result).toBe("FakeExtractedClassComponent");
    });
  });

  test("falls back to the fiber display name when no source map resolves", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const fetchFn = async () => new Response("const noSourceMapHere = 1;", { status: 200 });
      return window.__BIPPY__.getDisplayNameFromSource(fiber, false, fetchFn);
    });
    expect(result).toBe("TestChild");
  });
});

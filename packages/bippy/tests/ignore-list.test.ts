import { expect, it } from "vitest";
import {
  getSourceFromSourceMap,
  getSourceMap,
  sourceMapCache,
} from "../src/source/symbolication.js";

// line 1 maps to sources[0], line 2 maps to sources[1]
const MAPPINGS_TWO_SOURCES = "AAAA;ACAA";

const makeSourceMapFetch = (sourceMapBody: Record<string, unknown>) => {
  return (url: string): Promise<Response> => {
    if (url.endsWith(".map")) {
      return Promise.resolve(
        new Response(JSON.stringify(sourceMapBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(`const value = 1;\n//# sourceMappingURL=bundle.js.map`, { status: 200 }),
    );
  };
};

it("marks frames from ignoreList sources as ignored", async () => {
  const file = "http://localhost/ignore-list-bundle.js";
  sourceMapCache.delete(file);
  const sourceMap = await getSourceMap(
    file,
    false,
    makeSourceMapFetch({
      version: 3,
      sources: ["app.tsx", "node_modules/framework/index.js"],
      names: [],
      mappings: MAPPINGS_TWO_SOURCES,
      ignoreList: [1],
    }),
  );
  expect(sourceMap).not.toBeNull();
  if (!sourceMap) return;

  const appFrame = getSourceFromSourceMap(sourceMap, 1, 0);
  expect(appFrame?.fileName).toBe("app.tsx");
  expect(appFrame?.ignored).toBe(false);

  const frameworkFrame = getSourceFromSourceMap(sourceMap, 2, 0);
  expect(frameworkFrame?.fileName).toBe("node_modules/framework/index.js");
  expect(frameworkFrame?.ignored).toBe(true);
});

it("supports the legacy x_google_ignoreList field", async () => {
  const file = "http://localhost/legacy-ignore-list-bundle.js";
  sourceMapCache.delete(file);
  const sourceMap = await getSourceMap(
    file,
    false,
    makeSourceMapFetch({
      version: 3,
      sources: ["app.tsx", "vendor.js"],
      names: [],
      mappings: MAPPINGS_TWO_SOURCES,
      x_google_ignoreList: [1],
    }),
  );
  expect(sourceMap).not.toBeNull();
  if (!sourceMap) return;

  const vendorFrame = getSourceFromSourceMap(sourceMap, 2, 0);
  expect(vendorFrame?.fileName).toBe("vendor.js");
  expect(vendorFrame?.ignored).toBe(true);
});

it("leaves ignored false when the map has no ignore list", async () => {
  const file = "http://localhost/no-ignore-list-bundle.js";
  sourceMapCache.delete(file);
  const sourceMap = await getSourceMap(
    file,
    false,
    makeSourceMapFetch({
      version: 3,
      sources: ["app.tsx"],
      names: [],
      mappings: "AAAA",
    }),
  );
  expect(sourceMap).not.toBeNull();
  if (!sourceMap) return;

  const appFrame = getSourceFromSourceMap(sourceMap, 1, 0);
  expect(appFrame?.fileName).toBe("app.tsx");
  expect(appFrame?.ignored).toBe(false);
});

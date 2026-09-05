import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { getSourceMap, parseHookNames } from "bippy/source";
import type { HooksNode, HookSource, SourceFetch } from "bippy/source";
import { getFilesRecursively } from "./file-inventory.js";

interface SourceMapFixture {
  path: string;
  searchStart?: string;
}

const sourceDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/hook-sources/__compiled__",
);
const sourceMapFixtures: SourceMapFixture[] = [
  { path: "inline/Example.js" },
  { path: "external/Example.js" },
  { path: "inline/index-map/Example.js" },
  { path: "external/index-map/Example.js" },
  { path: "bundle/index.js", searchStart: "function Component$6" },
  { path: "no-columns/Example.js" },
  { path: "inline/fb-sources-extended/Example.js" },
  { path: "external/fb-sources-extended/Example.js" },
  { path: "inline/react-sources-extended/Example.js" },
  { path: "external/react-sources-extended/Example.js" },
  { path: "inline/fb-sources-extended/index-map/Example.js" },
  { path: "external/fb-sources-extended/index-map/Example.js" },
  { path: "inline/react-sources-extended/index-map/Example.js" },
  { path: "external/react-sources-extended/index-map/Example.js" },
];
const inlineRequireFixtures: SourceMapFixture[] = [
  { path: "../InlineRequire.js" },
  { path: "inline/InlineRequire.js" },
  { path: "external/InlineRequire.js" },
  { path: "inline/index-map/InlineRequire.js" },
  { path: "external/index-map/InlineRequire.js" },
  { path: "bundle/index.js", searchStart: "function Component$7" },
  { path: "no-columns/InlineRequire.js" },
];
const extendedInlineRequireFixtures: SourceMapFixture[] = [
  { path: "inline/fb-sources-extended/InlineRequire.js" },
  { path: "external/fb-sources-extended/InlineRequire.js" },
  { path: "inline/react-sources-extended/InlineRequire.js" },
  { path: "external/react-sources-extended/InlineRequire.js" },
  { path: "inline/fb-sources-extended/index-map/InlineRequire.js" },
  { path: "external/fb-sources-extended/index-map/InlineRequire.js" },
  { path: "inline/react-sources-extended/index-map/InlineRequire.js" },
  { path: "external/react-sources-extended/index-map/InlineRequire.js" },
];

const getHookSourceLocationKey = (hookSource: HookSource): string =>
  `${hookSource.fileName ?? ""}:${hookSource.lineNumber ?? 0}:${hookSource.columnNumber ?? 0}`;

const fetchSource: SourceFetch = async (url) => {
  try {
    return new Response(readFileSync(fileURLToPath(url), "utf8"), { status: 200 });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};

const getHook = (fixture: SourceMapFixture): HooksNode => {
  const path = join(sourceDirectory, fixture.path);
  const source = readFileSync(path, "utf8");
  const searchStart = fixture.searchStart ? source.indexOf(fixture.searchStart) : 0;
  const hookIndex = source.indexOf("useState", searchStart);
  if (hookIndex < 0) throw new Error(`Missing useState in ${fixture.path}`);
  const sourceBeforeHook = source.slice(0, hookIndex);
  const linesBeforeHook = sourceBeforeHook.split("\n");
  return {
    debugInfo: null,
    hookSource: {
      columnNumber: linesBeforeHook.at(-1)?.length ?? 0,
      fileName: pathToFileURL(path).href,
      functionName: null,
      lineNumber: linesBeforeHook.length,
    },
    id: 0,
    isStateEditable: true,
    name: "State",
    subHooks: [],
    value: 0,
  };
};

describe("upstream hook source-map fixtures", () => {
  it("loads every compiled inline, external, index, bundle, extended, and columnless map", async () => {
    const sourceMappedPaths = getFilesRecursively(sourceDirectory).filter(
      (path) => path.endsWith(".js") && readFileSync(path, "utf8").includes("sourceMappingURL="),
    );
    expect(sourceMappedPaths).toHaveLength(144);
    for (const path of sourceMappedPaths) {
      const sourceMap = await getSourceMap(pathToFileURL(path).href, false, fetchSource);
      expect(sourceMap?.sources.length, path).toBeGreaterThan(0);
    }
  });

  it.each(sourceMapFixtures)("parses $path", async (fixture) => {
    const hook = getHook(fixture);
    const hookNames = await parseHookNames([hook], fetchSource);
    if (!hook.hookSource) throw new Error("Missing hook source");
    expect(hookNames.get(getHookSourceLocationKey(hook.hookSource))).toBe("count");
  });

  it("should work for inline requires", async () => {
    for (const fixture of inlineRequireFixtures) {
      const hook = getHook(fixture);
      const hookNames = await parseHookNames([hook], fetchSource);
      if (!hook.hookSource) throw new Error("Missing hook source");
      expect(hookNames.get(getHookSourceLocationKey(hook.hookSource)), fixture.path).toBe("count");
    }
  });

  it("should work for inline requires", async () => {
    for (const fixture of extendedInlineRequireFixtures) {
      const hook = getHook(fixture);
      const hookNames = await parseHookNames([hook], fetchSource);
      if (!hook.hookSource) throw new Error("Missing hook source");
      expect(hookNames.get(getHookSourceLocationKey(hook.hookSource)), fixture.path).toBe("count");
    }
  });
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const packageRequire = createRequire(import.meta.url);
const rendererDirectory = join(
  dirname(packageRequire.resolve("react-native/package.json")),
  "Libraries/Renderer/implementations",
);
const rendererBundles = [
  "ReactFabric-dev.js",
  "ReactFabric-prod.js",
  "ReactFabric-profiling.js",
  "ReactNativeRenderer-dev.js",
  "ReactNativeRenderer-prod.js",
  "ReactNativeRenderer-profiling.js",
];

describe.each(rendererBundles)("react-native %s", (bundleName) => {
  it("binds a new reducer's Fiber and queue", () => {
    const source = readFileSync(join(rendererDirectory, bundleName), "utf8");
    expect(source).toMatch(
      /dispatchReducerAction\.bind\(\s*null,\s*currentlyRenderingFiber,\s*\w+/,
    );
    expect(source).toContain("lastRenderedReducer:");
  });
});

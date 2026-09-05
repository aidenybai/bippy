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

// React Native cannot run in this test environment, so lock the assumption that its shipped
// reconciler bundles bind the rendering Fiber as the first bound argument of useSyncExternalStore.
describe.each(rendererBundles)("react-native %s", (bundleName) => {
  it("binds the Fiber first inside useSyncExternalStore", () => {
    const source = readFileSync(join(rendererDirectory, bundleName), "utf8");
    const binds = source.match(/subscribeToStore\.bind\(\s*null,\s*(\w+),/g) ?? [];
    expect(binds.length).toBeGreaterThanOrEqual(2);
    expect(binds.every((bind) => /\(\s*null,\s*fiber,/.test(bind))).toBe(true);
  });
});

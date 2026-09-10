import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { getExpoWebResolution, servesWebWithMetro } from "../src/graph/expo-web.js";
import { detectModuleBundler } from "../src/graph/module-transpiler.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";

const APP = path.join(import.meta.dirname, "fixtures/expo-metro-web");

const createApp = (manifest: Record<string, unknown>, appConfig: unknown): string => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "expo-web-"));
  writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(manifest));
  if (appConfig !== undefined) {
    writeFileSync(path.join(rootDirectory, "app.json"), JSON.stringify(appConfig));
  }
  return rootDirectory;
};

const EXPO_MANIFEST = { dependencies: { expo: "~51.0.0" } };

describe("expo metro web", () => {
  it("is the bundler of an Expo app unless `expo.web.bundler` picks webpack", () => {
    expect(detectModuleBundler(createApp(EXPO_MANIFEST, undefined))).toBe("metro");
    expect(detectModuleBundler(createApp(EXPO_MANIFEST, { expo: {} }))).toBe("metro");
    expect(
      servesWebWithMetro(createApp(EXPO_MANIFEST, { expo: { web: { bundler: "webpack" } } })),
    ).toBe(false);
    expect(
      getExpoWebResolution(createApp({ dependencies: { react: "18" } }, undefined)),
    ).toBeNull();
  });

  it("tries `.web.*` variants first, aliases `react-native` and ignores package `exports` before Metro 0.82", () => {
    expect(getExpoWebResolution(APP)).toEqual({
      extensions: [
        ".web.ts",
        ".web.tsx",
        ".web.mjs",
        ".web.js",
        ".web.jsx",
        ".web.json",
        ".web.cjs",
        ".ts",
        ".tsx",
        ".mjs",
        ".js",
        ".jsx",
        ".json",
        ".cjs",
      ],
      aliases: { "react-native": "react-native-web" },
      exportsFields: [],
    });
  });

  it("renders through Metro's web resolution, dev prelude and the installed Reanimated Babel plugin", async () => {
    const renderer = await createStaticRenderer({
      rootDirectory: APP,
      tsconfigPath: path.join(APP, "tsconfig.json"),
      externalPackageAllowList: ["react-native-web", "platform-badge", "react-native-reanimated"],
    });
    const result = await renderer.renderEntry(path.join(APP, "src/main.tsx"));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.stats.unknownCount).toBe(0);
    expect(formatPattern(getRenderPattern(result))).toBe(
      [
        "<HostRoot>",
        "  <App>",
        "    <View>",
        "      <div>",
        "        <Banner>",
        "          <header>",
        "        <Badge>",
        "          <em>",
        "        <b>",
        "        <Text>",
        "          <span>",
        "        <Fade>",
        "          <Text>",
        "            <span>",
        '              "captures "',
        '              "opacity"',
      ].join("\n"),
    );
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { createTanStackRouterTransform } from "../src/graph/tanstack-router-plugin.js";

const PLUGIN_PACKAGE = {
  "node_modules/@tanstack/router-plugin/package.json": JSON.stringify({
    name: "@tanstack/router-plugin",
    exports: { "./vite": "./vite.cjs" },
  }),
  "node_modules/@tanstack/router-plugin/vite.cjs": [
    "const plugins = [",
    "  { name: 'with-hook', configResolved(config) { plugins.command = config.command; } },",
    "  { name: 'plain' },",
    "];",
    "exports.tanstackRouter = function tanstackRouter() { return plugins; };",
    "exports.TanStackRouterVite = 1;",
  ].join("\n"),
};

const writeProject = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "bippy-tanstack-"));
  for (const [name, contents] of Object.entries(files)) {
    const filePath = join(root, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }
  return root;
};

const config = (source: string, withPlugin: boolean): Record<string, string> => ({
  "package.json": JSON.stringify({ name: "tanstack-fixture", private: true }),
  "vite.config.ts": source,
  ...(withPlugin ? PLUGIN_PACKAGE : {}),
});

const load = async (files: Record<string, string>) => {
  const root = writeProject(files);
  try {
    return await createTanStackRouterTransform({
      configPath: join(root, "vite.config.ts"),
      cliMode: null,
      cwd: root,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("tanstack router plugin", () => {
  it("ignores a vite config that never calls the plugin factory", async () => {
    const absent = await load(
      config(
        [
          'import router from "@tanstack/router-plugin/vite";',
          'import "@tanstack/router-plugin/vite";',
          'import { helper } from "@tanstack/router-plugin/vite";',
          'import { tanstackRouter } from "other-plugin";',
          "export default { plugins: [router, helper, tanstackRouter] };",
        ].join("\n"),
        false,
      ),
    );
    expect(absent).toBeNull();
  });

  it("ignores a call whose options are not a JSON literal, including a later call", async () => {
    const sources = [
      "tanstackRouter(options); tanstackRouter({ target: 'react' });",
      "tanstackRouter(...plugins);",
      "tanstackRouter(1n);",
      "tanstackRouter(/react/);",
      "tanstackRouter(`${name}`);",
      "tanstackRouter([1, , 2]);",
      "tanstackRouter([1, name]);",
      "tanstackRouter([1, ...rest]);",
      "tanstackRouter({ ['target']: 'react' });",
      "tanstackRouter({ ...options });",
      "tanstackRouter({ get target() { return 'react'; } });",
      "tanstackRouter({ 1: true });",
      "tanstackRouter({ target() {} });",
      "tanstackRouter(options ?? name);",
    ];
    for (const body of sources) {
      const transform = await load(
        config(
          [
            'import { tanstackRouter } from "@tanstack/router-plugin/vite";',
            `const options = {}; const plugins = []; const rest = []; const name = "react";`,
            body,
          ].join("\n"),
          false,
        ),
      );
      expect(transform).toBeNull();
    }
  });

  it("runs the installed factory for literal options and a string import name", async () => {
    const named = await load(
      config(
        [
          'import { "tanstackRouter" as makeRouter } from "@tanstack/router-plugin/vite";',
          "export default { plugins: [makeRouter(`react`)] };",
        ].join("\n"),
        true,
      ),
    );
    expect(named).not.toBeNull();
    if (named) {
      expect(named.appliesTo("tsx", null, null)).toBe(false);
      expect(named.appliesTo("tsx", "tsx", null)).toBe(true);
      expect(named.transform(join("src", "routes", "index.tsx"), "export {}", null)).toBeNull();
      expect(named.transform("types.d.ts", "export {}", "tsr")).toBeNull();
    }
    const legacy = await load(
      config(
        [
          'import { TanStackRouterVite } from "@tanstack/router-plugin/vite";',
          "export default { plugins: [TanStackRouterVite()] };",
        ].join("\n"),
        true,
      ),
    );
    expect(legacy).toBeNull();
    const called = await load(
      config(
        [
          'import { tanstackRouter } from "@tanstack/router-plugin/vite";',
          "export default { plugins: [tanstackRouter()] };",
        ].join("\n"),
        true,
      ),
    );
    expect(called?.appliesTo(".ts", "ts", null)).toBe(true);
    const missing = await load(
      config(
        [
          'import { tanstackRouter } from "@tanstack/router-plugin/vite";',
          "export default { plugins: [tanstackRouter()] };",
        ].join("\n"),
        false,
      ),
    );
    expect(missing).toBeNull();
    const configured = await load(
      config(
        [
          'import { tanstackRouter } from "@tanstack/router-plugin/vite";',
          'export default { plugins: [tanstackRouter({ "target": "react", "flags": [1, false, null] })] };',
        ].join("\n"),
        true,
      ),
    );
    expect(configured?.appliesTo(".tsx", "tsx", "tsr")).toBe(true);
  });
});

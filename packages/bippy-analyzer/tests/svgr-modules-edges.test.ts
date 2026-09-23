import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { createProjectContext } from "../src/graph/project-context.js";
import { createSvgrSourceTransform } from "../src/graph/svgr-modules.js";
import type { JsonValue, ModuleBundler, ProjectContext } from "../src/types.js";

const directories: string[] = [];

const writeFile = (directory: string, filename: string, source: string): void => {
  const filePath = join(directory, filename);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
};

const createRoot = (): string => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-svgr-"));
  directories.push(rootDirectory);
  writeFile(rootDirectory, "package.json", JSON.stringify({ name: "svgr-edges", version: "0.0.0" }));
  return rootDirectory;
};

const openProject = (
  rootDirectory: string,
  bundler: ModuleBundler = "unknown",
): { project: ProjectContext; resolver: ModuleResolver } => {
  const resolver = new ModuleResolver({ rootDirectory });
  const project = createProjectContext({ rootDirectory, resolver, bundler });
  return { project, resolver };
};

const writePackage = (rootDirectory: string, packageName: string, source: string): void => {
  writeFile(
    rootDirectory,
    join("node_modules", packageName, "package.json"),
    JSON.stringify({ name: packageName, version: "1.0.0", main: "index.js" }),
  );
  writeFile(rootDirectory, join("node_modules", packageName, "index.js"), source);
};

const coreWith = (transformSource: string, loadConfigSource = "function loadConfigSync() { return {}; }"): string =>
  `${loadConfigSource}
loadConfigSync.sync = loadConfigSync;
${transformSource}
module.exports = { transform, loadConfig: loadConfigSync };
`;

const syncTransform = (body: string): string =>
  `function transformSync(svgText, config, state) { ${body} }
function transform() {}
transform.sync = transformSync;
`;

const pluginModule = (marker: string): string =>
  `function plugin(svgText) { return this.marker + ":" + svgText; }
module.exports = { default: plugin, marker: ${JSON.stringify(marker)} };
`;

const transformSvg = (
  rootDirectory: string,
  options?: Record<string, JsonValue>,
  bundler: ModuleBundler = "unknown",
): ReturnType<typeof createSvgrSourceTransform> => {
  const { project, resolver } = openProject(rootDirectory, bundler);
  return createSvgrSourceTransform(project, resolver, rootDirectory, options);
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("svgr module edges", () => {
  it("emits tsx when the loaded svgr config asks for typescript", () => {
    const rootDirectory = createRoot();
    writePackage(
      rootDirectory,
      "@svgr/core",
      coreWith(
        syncTransform("return 'export const Icon = () => null';"),
        "function loadConfigSync() { return { typescript: true }; }",
      ),
    );
    const transform = transformSvg(rootDirectory, {});
    expect(transform).not.toBeNull();
    expect(transform?.appliesTo(".svg", null, null)).toBe(true);
    expect(transform?.appliesTo(".svg", null, "react")).toBe(false);
    expect(transform?.appliesTo(".png", null, null)).toBe(false);
    expect(transform?.transform(join(rootDirectory, "icon.svg"), "<svg />", null)).toEqual({
      sourceText: "export const Icon = () => null",
      lang: "tsx",
    });
  });

  it("keeps jsx when the svgr config cannot be parsed", () => {
    const rootDirectory = createRoot();
    writePackage(
      rootDirectory,
      "@svgr/core",
      coreWith(
        syncTransform("return 'export const Icon = () => null';"),
        "function loadConfigSync() { return { typescript: 'yes' }; }",
      ),
    );
    const transform = transformSvg(rootDirectory, {});
    expect(transform?.transform(join(rootDirectory, "icon.svg"), "<svg />", null)).toEqual({
      sourceText: "export const Icon = () => null",
      lang: "jsx",
    });
  });

  it("drops an svg whose transform does not return source text", () => {
    const rootDirectory = createRoot();
    writePackage(rootDirectory, "@svgr/core", coreWith(syncTransform("return 0;")));
    const transform = transformSvg(rootDirectory, {});
    expect(transform?.transform(join(rootDirectory, "icon.svg"), "<svg />", null)).toBeNull();
  });

  it("drops an svg whose transform throws", () => {
    const rootDirectory = createRoot();
    writePackage(
      rootDirectory,
      "@svgr/core",
      coreWith(syncTransform("throw new Error('svgr failed');")),
    );
    const transform = transformSvg(rootDirectory, {});
    expect(transform?.transform(join(rootDirectory, "icon.svg"), "<svg />", null)).toBeNull();
  });

  it("uses the default export when transform itself is not a function", () => {
    const rootDirectory = createRoot();
    writePackage(
      rootDirectory,
      "@svgr/core",
      `function fallbackSync() { return "export const FallbackIcon = 1"; }
fallbackSync.sync = fallbackSync;
function loadConfigSync() { return { typescript: true }; }
loadConfigSync.sync = loadConfigSync;
module.exports = { transform: false, default: fallbackSync, loadConfig: loadConfigSync };
`,
    );
    const transform = transformSvg(rootDirectory, {});
    expect(transform?.transform(join(rootDirectory, "icon.svg"), "<svg />", null)).toEqual({
      sourceText: "export const FallbackIcon = 1",
      lang: "tsx",
    });
  });

  it("returns no transform when svgr exports functions without a sync entry", () => {
    const rootDirectory = createRoot();
    writePackage(
      rootDirectory,
      "@svgr/core",
      "module.exports = { transform: function transform() {}, loadConfig: function loadConfig() {} };",
    );
    expect(transformSvg(rootDirectory, {})).toBeNull();
  });

  it("calls plugin default exports with the plugin module as this", () => {
    const rootDirectory = createRoot();
    writePackage(rootDirectory, "@svgr/webpack", "module.exports = {};");
    writePackage(
      rootDirectory,
      "@svgr/core",
      coreWith(
        syncTransform(
          "const plugins = state.caller.defaultPlugins.map((plugin) => plugin(svgText)); return 'export const marks = ' + JSON.stringify(plugins.join(','));",
        ),
      ),
    );
    writePackage(rootDirectory, "@svgr/plugin-svgo", pluginModule("svgo"));
    writePackage(rootDirectory, "@svgr/plugin-jsx", pluginModule("jsx"));
    const transform = transformSvg(rootDirectory);
    expect(transform?.transform(join(rootDirectory, "icon.svg"), "<svg />", null)?.sourceText).toBe(
      'export const marks = "svgo:<svg />,jsx:<svg />"',
    );
  });

  it("returns no transform when a default plugin does not export a function", () => {
    const rootDirectory = createRoot();
    writePackage(rootDirectory, "@svgr/webpack", "module.exports = {};");
    writePackage(rootDirectory, "@svgr/core", coreWith(syncTransform("return 'export const Icon = 1';")));
    writePackage(rootDirectory, "@svgr/plugin-svgo", "module.exports = { default: 1 };");
    writePackage(rootDirectory, "@svgr/plugin-jsx", pluginModule("jsx"));
    expect(transformSvg(rootDirectory)).toBeNull();
  });

  it("uses the docusaurus svgr rule when that plugin is installed", () => {
    const rootDirectory = createRoot();
    const seenPath = join(rootDirectory, "seen.json");
    writePackage(rootDirectory, "@svgr/webpack", "module.exports = {};");
    writePackage(rootDirectory, "@docusaurus/plugin-svgr", "module.exports = {};");
    writePackage(rootDirectory, "@svgr/plugin-svgo", "module.exports = function plugin() { return null; };");
    writePackage(rootDirectory, "@svgr/plugin-jsx", "module.exports = function plugin() { return null; };");
    writePackage(
      rootDirectory,
      "@svgr/core",
      coreWith(
        `const fs = require("node:fs");
function transformSync(svgText, config) {
  fs.writeFileSync(${JSON.stringify(seenPath)}, JSON.stringify(config));
  return "export const Icon = 1";
}
function transform() {}
transform.sync = transformSync;
`,
      ),
    );
    const transform = transformSvg(rootDirectory);
    expect(transform?.transform(join(rootDirectory, "logo.svg"), "<svg />", null)?.sourceText).toBe(
      "export const Icon = 1",
    );
    expect(JSON.parse(readFileSync(seenPath, "utf8"))).toMatchObject({
      svgo: true,
      titleProp: true,
    });
  });

  it("transforms only svg?react imports for vite-plugin-svgr", () => {
    const rootDirectory = createRoot();
    writePackage(rootDirectory, "vite-plugin-svgr", "module.exports = {};");
    writePackage(rootDirectory, "@svgr/plugin-jsx", pluginModule("jsx"));
    writePackage(
      rootDirectory,
      "@svgr/core",
      coreWith(
        syncTransform(
          "return 'export const marks = ' + JSON.stringify(state.caller.defaultPlugins.map((plugin) => plugin(svgText)).join(','));",
        ),
      ),
    );
    const transform = transformSvg(rootDirectory, undefined, "vite");
    expect(transform?.appliesTo(".svg", null, "react")).toBe(true);
    expect(transform?.appliesTo(".svg", null, null)).toBe(false);
    expect(transform?.appliesTo(".svg", null, "url")).toBe(false);
    expect(transform?.transform(join(rootDirectory, "icon.svg"), "<svg />", "react")?.sourceText).toBe(
      'export const marks = "jsx:<svg />"',
    );
  });
});

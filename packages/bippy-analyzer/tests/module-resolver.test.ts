import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";

const APP = join(import.meta.dirname, "resolver-fixtures/browser-field");
const PACKAGE_DIST = join(APP, "node_modules/env-kit/dist");
const IMPORTER = join(APP, "src/app.tsx");

const SUBPATH_APP = join(import.meta.dirname, "resolver-fixtures/subpath-file");
const SUBPATH_IMPORTER = join(SUBPATH_APP, "src/app.tsx");
const SUBPATH_FILE = join(SUBPATH_APP, "node_modules/script-kit/script.js");

const CONDITIONS_APP = join(import.meta.dirname, "resolver-fixtures/conditions");
const CONDITION_KIT = join(CONDITIONS_APP, "node_modules/condition-kit");

describe("module resolver", () => {
  it("follows a `browser` field file map like a web bundler, for the entry and inside the package", () => {
    const resolver = new ModuleResolver({ rootDirectory: APP });
    expect(resolver.resolve("env-kit", IMPORTER)).toEqual({
      kind: "external",
      packageName: "env-kit",
      filePath: join(PACKAGE_DIST, "index.browser.esm.js"),
      specifier: "env-kit",
    });
    expect(
      resolver.resolve("./platform.js", join(PACKAGE_DIST, "index.browser.esm.js")),
    ).toMatchObject({ filePath: join(PACKAGE_DIST, "platform.browser.js") });
  });

  it("names an extension-qualified subpath by its extensionless form when both load the same file", () => {
    const resolver = new ModuleResolver({ rootDirectory: SUBPATH_APP });
    expect(resolver.resolve("script-kit/script.js", SUBPATH_IMPORTER, "commonjs")).toEqual({
      kind: "external",
      packageName: "script-kit",
      filePath: SUBPATH_FILE,
      specifier: "script-kit/script",
    });
    expect(resolver.resolve("script-kit/script", SUBPATH_IMPORTER, "commonjs")).toMatchObject({
      filePath: SUBPATH_FILE,
      specifier: "script-kit/script",
    });
    expect(resolver.resolve("script-kit/dist/index.js", SUBPATH_IMPORTER)).toMatchObject({
      specifier: "script-kit/dist/index",
    });
    expect(resolver.resolve("script-kit", SUBPATH_IMPORTER)).toMatchObject({
      specifier: "script-kit",
    });
  });

  it("selects Vite's development condition, and production only when NODE_ENV is production", () => {
    const importer = join(CONDITIONS_APP, "src/page.tsx");
    const development = new ModuleResolver({ rootDirectory: CONDITIONS_APP });
    expect(development.resolve("condition-kit", importer)).toMatchObject({
      filePath: join(CONDITION_KIT, "development.js"),
    });
    expect(development.resolve("condition-kit#ignored", importer)).toMatchObject({
      filePath: join(CONDITION_KIT, "development.js"),
    });
    const production = new ModuleResolver({
      rootDirectory: CONDITIONS_APP,
      nodeEnvironment: "production",
    });
    expect(production.resolve("condition-kit", importer)).toMatchObject({
      filePath: join(CONDITION_KIT, "production.js"),
    });
  });

  it("resolves Next server modules with react-server and Node conditions", () => {
    const importer = join(CONDITIONS_APP, "src/page.tsx");
    const resolver = new ModuleResolver({ rootDirectory: CONDITIONS_APP });
    expect(resolver.resolve("condition-kit", importer, "esm", "server")).toMatchObject({
      filePath: join(CONDITION_KIT, "server.js"),
    });
    expect(resolver.resolve("condition-kit/platform", importer, "esm", "server")).toMatchObject({
      filePath: join(CONDITION_KIT, "node.js"),
    });
    expect(resolver.resolve("condition-kit/platform", importer)).toMatchObject({
      filePath: join(CONDITION_KIT, "browser.js"),
    });
  });

  it("keeps browser resolution for use client modules inside a server graph", () => {
    const graph = new ModuleGraph({
      resolver: new ModuleResolver({ rootDirectory: CONDITIONS_APP }),
      serverModuleConditions: true,
    });
    const page = graph.getModule(join(CONDITIONS_APP, "src/page.tsx"));
    const widget = graph.getModule(join(CONDITIONS_APP, "src/widget.tsx"));
    if (!page || !widget) throw new Error("Missing condition fixture modules");
    expect(graph.resolveImportedModule("condition-kit", page)).toMatchObject({
      filePath: join(CONDITION_KIT, "server.js"),
    });
    expect(graph.resolveImportedModule("condition-kit/platform", page)).toMatchObject({
      filePath: join(CONDITION_KIT, "node.js"),
    });
    expect(graph.resolveImportedModule("condition-kit", widget)).toMatchObject({
      filePath: join(CONDITION_KIT, "development.js"),
    });
    expect(graph.resolveImportedModule("condition-kit/platform", widget)).toMatchObject({
      filePath: join(CONDITION_KIT, "browser.js"),
    });
  });
});

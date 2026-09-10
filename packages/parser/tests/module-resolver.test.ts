import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";

const APP = join(import.meta.dirname, "resolver-fixtures/browser-field");
const PACKAGE_DIST = join(APP, "node_modules/env-kit/dist");
const IMPORTER = join(APP, "src/app.tsx");

const SUBPATH_APP = join(import.meta.dirname, "resolver-fixtures/subpath-file");
const SUBPATH_IMPORTER = join(SUBPATH_APP, "src/app.tsx");
const SUBPATH_FILE = join(SUBPATH_APP, "node_modules/script-kit/script.js");

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
});

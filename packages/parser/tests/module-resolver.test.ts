import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";

const APP = join(import.meta.dirname, "resolver-fixtures/browser-field");
const PACKAGE_DIST = join(APP, "node_modules/env-kit/dist");
const IMPORTER = join(APP, "src/app.tsx");

describe("module resolver", () => {
  it("follows a `browser` field file map like a web bundler, for the entry and inside the package", () => {
    const resolver = new ModuleResolver({ rootDirectory: APP });
    expect(resolver.resolve("env-kit", IMPORTER)).toEqual({
      kind: "external",
      packageName: "env-kit",
      filePath: join(PACKAGE_DIST, "index.browser.esm.js"),
    });
    expect(
      resolver.resolve("./platform.js", join(PACKAGE_DIST, "index.browser.esm.js")),
    ).toMatchObject({ filePath: join(PACKAGE_DIST, "platform.browser.js") });
  });

  it("prefers an installed polyfill over the Node builtin like a web bundler, except for `node:` specifiers", () => {
    const app = join(import.meta.dirname, "resolver-fixtures/builtin-polyfill");
    const resolver = new ModuleResolver({ rootDirectory: app });
    const importer = join(app, "src/app.tsx");
    expect(resolver.resolve("events", importer)).toEqual({
      kind: "external",
      packageName: "events",
      filePath: join(app, "node_modules/events/events.js"),
    });
    expect(resolver.resolve("node:events", importer)).toEqual({
      kind: "builtin",
      specifier: "node:events",
    });
    expect(resolver.resolve("path", importer)).toEqual({ kind: "builtin", specifier: "path" });
  });
});

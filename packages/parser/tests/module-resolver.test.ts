import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";

const APP = join(import.meta.dirname, "resolver-fixtures/browser-field");
const PACKAGE_DIST = join(APP, "node_modules/env-kit/dist");
const IMPORTER = join(APP, "src/app.tsx");
const CONDITIONS_APP = join(import.meta.dirname, "resolver-fixtures/export-conditions");
const CONDITIONS_DIST = join(CONDITIONS_APP, "node_modules/intl-kit/dist");
const CONDITIONS_IMPORTER = join(CONDITIONS_APP, "src/app.tsx");

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

  it("takes the `development` export condition a dev server does, under the `react-server` condition too", () => {
    const resolver = new ModuleResolver({ rootDirectory: CONDITIONS_APP });
    expect(resolver.resolve("intl-kit", CONDITIONS_IMPORTER)).toMatchObject({
      filePath: join(CONDITIONS_DIST, "development/index.react-client.js"),
    });
    expect(resolver.resolve("intl-kit", CONDITIONS_IMPORTER, "esm", "server")).toMatchObject({
      filePath: join(CONDITIONS_DIST, "development/index.react-server.js"),
    });
  });
});

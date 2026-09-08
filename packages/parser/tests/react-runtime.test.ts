import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version as harnessReactVersion } from "react";
import { describe, expect, it } from "vite-plus/test";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { loadReactRuntime } from "../src/materialize/react-runtime.js";

const writePackage = (rootDirectory: string, name: string, source: string): void => {
  const packageDirectory = join(rootDirectory, "node_modules", name);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name, main: "index.js" }));
  writeFileSync(join(packageDirectory, "index.js"), source);
};

describe("loadReactRuntime", () => {
  it("uses the harness's React when the app's react-dom has no client entry", async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-legacy-react-"));
    writePackage(rootDirectory, "react", "module.exports = { version: '16.14.0' };");
    writePackage(rootDirectory, "react-dom", "module.exports = { version: '16.14.0' };");
    const resolver = new ModuleResolver({ rootDirectory });
    expect(resolver.resolve("react", join(rootDirectory, "index.js"))).toMatchObject({
      kind: "external",
      filePath: join(rootDirectory, "node_modules", "react", "index.js"),
    });
    const runtime = await loadReactRuntime({ resolver, rootDirectory });
    expect(runtime.version).toBe(harnessReactVersion);
  });
});

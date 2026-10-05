import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readInstalledPackage } from "../src/graph/installed-package.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { detectModuleTranspiler } from "../src/graph/module-transpiler.js";
import { createProjectContext } from "../src/graph/project-context.js";

const installPackage = (rootDirectory: string, manifest: Record<string, unknown>): void => {
  const name = manifest["name"];
  if (typeof name !== "string") throw new Error("package needs a name");
  const packageDirectory = path.join(rootDirectory, "node_modules", name);
  mkdirSync(path.join(packageDirectory, "dist"), { recursive: true });
  writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify(manifest));
  writeFileSync(path.join(packageDirectory, "dist", "index.js"), "export default 1;\n");
};

describe("installed packages", () => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "installed-package-"));
  writeFileSync(path.join(rootDirectory, "package.json"), '{ "name": "app" }');
  installPackage(rootDirectory, { name: "open-kit", version: "1.2.3", main: "./dist/index.js" });
  installPackage(rootDirectory, {
    name: "sealed-kit",
    version: "3.21.1",
    exports: { ".": "./dist/index.js" },
  });
  installPackage(rootDirectory, {
    name: "vite-wrapper",
    version: "0.3.1",
    bundledVersions: { vite: "8.2.2" },
    main: "./dist/index.js",
  });
  symlinkSync(
    path.join(rootDirectory, "node_modules/vite-wrapper"),
    path.join(rootDirectory, "node_modules/vite"),
    "dir",
  );
  writeFileSync(path.join(rootDirectory, "vite.config.ts"), "export default {};\n");
  installPackage(rootDirectory, {
    name: "sealed-wrapper",
    version: "0.3.1",
    bundledVersions: { "sealed-engine": "8.2.2" },
    exports: { ".": "./dist/index.js" },
  });
  symlinkSync(
    path.join(rootDirectory, "node_modules/sealed-wrapper"),
    path.join(rootDirectory, "node_modules/sealed-engine"),
    "dir",
  );
  const resolver = new ModuleResolver({ rootDirectory });

  it("reads bundled metadata when the wrapper hides package.json", () => {
    expect(
      createProjectContext({ rootDirectory, resolver }).readPackageVersion("sealed-engine"),
    ).toBe("8.2.2");
  });

  it("uses the bundled engine version without replacing the wrapper's package identity", () => {
    expect(readInstalledPackage(resolver, rootDirectory, "vite")?.version).toBe("0.3.1");
    expect(createProjectContext({ rootDirectory, resolver }).readPackageVersion("vite")).toBe(
      "8.2.2",
    );
    expect(detectModuleTranspiler(resolver, rootDirectory)).toBe("name-preserving");
  });

  it("reads the manifest the package exposes", () => {
    expect(readInstalledPackage(resolver, rootDirectory, "open-kit")).toEqual({
      name: "open-kit",
      version: "1.2.3",
    });
  });

  it("finds the owning manifest when `exports` hides package.json", () => {
    expect(readInstalledPackage(resolver, rootDirectory, "sealed-kit")).toEqual({
      name: "sealed-kit",
      version: "3.21.1",
    });
  });

  it("is null for packages that are not installed", () => {
    expect(readInstalledPackage(resolver, rootDirectory, "absent-kit")).toBeNull();
  });
});

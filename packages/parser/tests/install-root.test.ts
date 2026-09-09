import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { findInstallRoot } from "../src/graph/install-root.js";
import { readInstalledPackage } from "../src/graph/installed-package.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { createProjectContext } from "../src/graph/project-context.js";

const writePackage = (directory: string, manifest: object): void => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
  writeFileSync(path.join(directory, "index.js"), "module.exports = {};\n");
};

/** `<outer>/checkout/packages/app`: the checkout has the lockfile, the outer directory installs a bundler plugin the app never asked for. */
const createLayout = (): { outer: string; app: string } => {
  const outer = mkdtempSync(path.join(tmpdir(), "bippy-install-root-"));
  const checkout = path.join(outer, "checkout");
  const app = path.join(checkout, "packages", "app");
  writePackage(path.join(outer, "node_modules", "@svgr", "webpack"), {
    name: "@svgr/webpack",
    version: "8.1.0",
  });
  writePackage(outer, { name: "host", devDependencies: { "@svgr/webpack": "8.1.0" } });
  writePackage(checkout, { name: "checkout", devDependencies: { vite: "6.0.0" } });
  writeFileSync(path.join(checkout, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  writePackage(path.join(checkout, "node_modules", "react"), { name: "react", version: "19.0.0" });
  writePackage(app, { name: "app", dependencies: { react: "19.0.0" } });
  return { outer, app };
};

describe("install root", () => {
  it("is the nearest ancestor holding a lockfile", () => {
    const { outer, app } = createLayout();
    expect(findInstallRoot(app)).toBe(path.join(outer, "checkout"));
    expect(findInstallRoot(path.join(outer, "checkout"))).toBe(path.join(outer, "checkout"));
  });

  it("is the workspace root when a member checks in its own lockfile", () => {
    const { outer, app } = createLayout();
    const checkout = path.join(outer, "checkout");
    mkdirSync(path.join(checkout, ".git"));
    writeFileSync(path.join(app, "package-lock.json"), "{}\n");
    expect(findInstallRoot(app)).toBe(checkout);
    const resolver = new ModuleResolver({ rootDirectory: app });
    expect(readInstalledPackage(resolver, app, "react")?.version).toBe("19.0.0");
    expect(readInstalledPackage(resolver, app, "@svgr/webpack")).toBeNull();
  });

  it("does not count packages only the checkout's host installed", () => {
    const { app } = createLayout();
    const resolver = new ModuleResolver({ rootDirectory: app });
    expect(readInstalledPackage(resolver, app, "react")?.version).toBe("19.0.0");
    expect(readInstalledPackage(resolver, app, "@svgr/webpack")).toBeNull();
    const project = createProjectContext({ rootDirectory: app, resolver });
    expect(project.hasDeclaredDependency("vite")).toBe(true);
    expect(project.hasDeclaredDependency("@svgr/webpack")).toBe(false);
  });
});

import { describe, expect, it } from "vite-plus/test";
import { build } from "esbuild";
import { createResolver } from "../src/index.js";
import { createResolverProject } from "./helpers/resolver-project.js";

describe("project discovery", () => {
  it("discovers Node-only builtins without selecting an execution platform", () => {
    const project = createResolverProject();
    const resolver = createResolver({ rootDirectory: project.directory });
    expect(resolver.discover("node:fs", project.importer)).toMatchObject({
      classification: "node-only",
      browser: { kind: "unresolved", specifier: "node:fs", error: expect.any(String) },
      node: { kind: "builtin", id: "node:fs" },
    });
    expect(resolver.resolve("node:fs", project.importer)).toMatchObject({
      kind: "unresolved",
      error: expect.stringContaining("Select a platform"),
    });
    expect(() => resolver.getConfiguration(project.importer)).toThrow("Select a platform");
    expect(resolver.resolve("node:fs", project.importer, { platform: "browser" }).kind).toBe(
      "unresolved",
    );
    expect(resolver.resolve("node:fs", project.importer, { platform: "node" })).toEqual({
      kind: "builtin",
      id: "node:fs",
    });
  });

  it("retains different export targets and matches both native esbuild platforms", async () => {
    const project = createResolverProject();
    project.write("node_modules/conditional/package.json", {
      exports: { browser: "./browser.js", node: "./node.js", default: "./fallback.js" },
    });
    const browser = project.write("node_modules/conditional/browser.js", "export {};");
    const node = project.write("node_modules/conditional/node.js", "export {};");
    project.write("node_modules/conditional/fallback.js", "export {};");
    const resolver = createResolver({ rootDirectory: project.directory, platform: "node" });
    expect(resolver.discover("conditional", project.importer)).toEqual({
      classification: "both",
      browser: { kind: "file", id: browser },
      node: { kind: "file", id: node },
    });
    expect(resolver.resolve("conditional", project.importer)).toEqual({ kind: "file", id: node });
    project.write("src/app.tsx", "import 'conditional';");
    const platforms: Array<"browser" | "node"> = ["browser", "node"];
    for (const platform of platforms) {
      const native = await build({
        absWorkingDir: project.directory,
        entryPoints: [project.importer],
        platform,
        bundle: true,
        write: false,
        metafile: true,
      });
      const inputs = Object.keys(native.metafile.inputs);
      expect(inputs).toContain(`node_modules/conditional/${platform}.js`);
      expect(inputs).not.toContain(
        `node_modules/conditional/${platform === "browser" ? "node" : "browser"}.js`,
      );
      expect(inputs).not.toContain("node_modules/conditional/fallback.js");
    }
  });

  it("reports browser-only targets without retrying Node using browser conditions", () => {
    const project = createResolverProject();
    project.write("node_modules/browser-package/package.json", {
      exports: { browser: "./index.js" },
    });
    const target = project.write("node_modules/browser-package/index.js", "export {};");
    const resolver = createResolver({ rootDirectory: project.directory });
    expect(resolver.discover("browser-package", project.importer)).toMatchObject({
      classification: "browser-only",
      browser: { kind: "file", id: target },
      node: { kind: "unresolved" },
    });
  });

  it("retains identical file identities and suffixes in both contexts", () => {
    const project = createResolverProject();
    const target = project.write("src/shared.ts", "export {};");
    const resolver = createResolver({ rootDirectory: project.directory });
    const result = resolver.discover("./shared?raw#fragment", project.importer);
    expect(result).toEqual({
      classification: "both",
      browser: { kind: "file", id: `${target}?raw#fragment` },
      node: { kind: "file", id: `${target}?raw#fragment` },
    });
    expect(result.browser).not.toBe(result.node);
  });

  it("keeps import and require branches separate in each context", () => {
    const project = createResolverProject();
    project.write("node_modules/conditional/package.json", {
      exports: {
        browser: { import: "./browser-import.js", require: "./browser-require.js" },
        node: { import: "./node-import.js", require: "./node-require.js" },
      },
    });
    const resolver = createResolver({ rootDirectory: project.directory });
    const kinds: Array<"import" | "require"> = ["import", "require"];
    for (const kind of kinds) {
      const browser = project.write(`node_modules/conditional/browser-${kind}.js`, "export {};");
      const node = project.write(`node_modules/conditional/node-${kind}.js`, "export {};");
      expect(resolver.discover("conditional", project.importer, { kind })).toEqual({
        classification: "both",
        browser: { kind: "file", id: browser },
        node: { kind: "file", id: node },
      });
    }
  });

  it("preserves ignored decisions rather than inventing executable browser targets", () => {
    const project = createResolverProject();
    project.write("package.json", { name: "fixture", browser: { "./src/server.ts": false } });
    const target = project.write("src/server.ts", "export {};");
    expect(
      createResolver({ rootDirectory: project.directory }).discover("./server", project.importer),
    ).toEqual({
      classification: "both",
      browser: { kind: "ignored", specifier: "./server" },
      node: { kind: "file", id: target },
    });
  });

  it("preserves both failures and invalidates negative lookups on clearCache", () => {
    const project = createResolverProject();
    const resolver = createResolver({ rootDirectory: project.directory });
    expect(resolver.discover("./missing", project.importer)).toMatchObject({
      classification: "neither",
      browser: { kind: "unresolved", error: expect.any(String) },
      node: { kind: "unresolved", error: expect.any(String) },
    });
    project.write("src/missing.ts", "export {};");
    resolver.clearCache();
    expect(resolver.discover("./missing", project.importer).classification).toBe("both");
  });

  it("does not turn configuration errors into successful discovery", () => {
    const project = createResolverProject();
    project.write("vite.config.ts", "export default () => ({});");
    const result = createResolver({ rootDirectory: project.directory }).discover(
      "./app",
      project.importer,
    );
    expect(result).toMatchObject({
      classification: "neither",
      browser: { kind: "unresolved", error: expect.stringContaining("Dynamic configuration") },
      node: { kind: "unresolved", error: expect.stringContaining("Dynamic configuration") },
    });
  });
});

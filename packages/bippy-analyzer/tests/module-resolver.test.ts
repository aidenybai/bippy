import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { createBundlerFixtureResolver as createModuleResolver } from "./helpers/bundler-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

const project = createResolverProject();
const resolver = createModuleResolver({ rootDirectory: project.directory });
project.write("src/value.ts", "export const value = 1;");
project.write("src/with space.ts", "export {};");
project.write("src/nested/index.tsx", "export default () => null;");
project.write("src/data.json", { value: 1 });
project.write("src/style.css", ".example {}");
project.write("package.json", {
  name: "fixture-project",
  type: "module",
  exports: { ".": "./src/value.ts" },
  imports: { "#value": "./src/value.ts", "#nested/*": "./src/nested/*.tsx" },
});

it.each([
  ["./value", "src/value.ts"],
  ["./value.js", "src/value.ts"],
  ["./value.ts?raw", "src/value.ts?raw"],
  ["./value.ts?url#part", "src/value.ts?url#part"],
  ["./value.ts#part", "src/value.ts#part"],
  ["./nested", "src/nested/index.tsx"],
  ["./data.json", "src/data.json"],
  ["./style.css?inline", "src/style.css?inline"],
  ["#value", "src/value.ts"],
  ["#value?raw", "src/value.ts?raw"],
  ["#nested/index", "src/nested/index.tsx"],
  ["fixture-project", "src/value.ts"],
])("resolves %s without losing its module identity", (specifier, target) => {
  expect(resolver.resolve(specifier, project.importer)).toEqual({
    kind: "file",
    id: join(project.directory, target),
  });
});

it("resolves file URLs with escaped spaces and retained queries", () => {
  const url = pathToFileURL(join(project.directory, "src/with space.ts"));
  url.search = "?raw";
  expect(resolver.resolve(url.href, project.importer)).toEqual({
    kind: "file",
    id: join(project.directory, "src/with space.ts?raw"),
  });
});

it.each([
  "./missing",
  "missing-package",
  "missing-package/subpath",
  "#missing",
  "node:not-a-builtin",
  "node:fs?raw",
  "",
  "\0virtual:entry",
  "https://example.com/app.js",
  "data:text/javascript,export default 1",
  "raw-loader!./value.ts",
])("does not invent a module for %j", (specifier) => {
  expect(resolver.resolve(specifier, project.importer)).toMatchObject({
    kind: "unresolved",
    specifier,
    error: expect.any(String),
  });
});

it.each(["fs", "node:fs", "node:test"])("classifies %s without loading it", (specifier) => {
  expect(resolver.resolve(specifier, project.importer, "esm", "server")).toEqual({
    kind: "builtin",
    id: specifier.startsWith("node:") ? specifier : `node:${specifier}`,
  });
  expect(resolver.resolve(specifier, project.importer, "esm", "client").kind).toBe("unresolved");
});

it("requires an absolute importing file rather than relying on process.cwd", () => {
  expect(() => resolver.resolve("./value", "src/app.tsx")).toThrow("absolute path");
});

describe("configuration", () => {
  const configured = createResolverProject();
  configured.write("config/base.json", {
    compilerOptions: {
      baseUrl: "..",
      paths: { "@/*": ["src/*"], "fallback/*": ["absent/*", "src/*"], exact: ["src/value.ts"] },
    },
  });
  configured.write("tsconfig.json", { extends: "./config/base.json" });
  configured.write("src/value.ts", "export {};");
  configured.write("replacement.ts", "export {};");

  it.each(["@/value", "fallback/value", "exact"])(
    "discovers inherited tsconfig paths for %s",
    (specifier) => {
      const configuredResolver = createModuleResolver({ rootDirectory: configured.directory });
      expect(configuredResolver.resolve(specifier, configured.importer)).toEqual({
        kind: "file",
        id: join(configured.directory, "src/value.ts"),
      });
    },
  );

  it("gives explicit bundler aliases precedence over tsconfig paths", () => {
    const configuredResolver = createModuleResolver({
      rootDirectory: configured.directory,
      aliases: { "@": join(configured.directory, "replacement.ts") },
    });
    expect(configuredResolver.resolve("@/value", configured.importer).kind).toBe("unresolved");
    const exactResolver = createModuleResolver({
      rootDirectory: configured.directory,
      aliases: { exact: join(configured.directory, "replacement.ts") },
    });
    expect(exactResolver.resolve("exact", configured.importer)).toEqual({
      kind: "file",
      id: join(configured.directory, "replacement.ts"),
    });
  });

  it("does not match an alias against an unrelated prefix", () => {
    const configuredResolver = createModuleResolver({
      rootDirectory: configured.directory,
      aliases: { "@": join(configured.directory, "src") },
    });
    expect(configuredResolver.resolve("@/value?raw", configured.importer)).toEqual({
      kind: "file",
      id: join(configured.directory, "src/value.ts?raw"),
    });
    expect(configuredResolver.resolve("@other/value", configured.importer).kind).toBe("unresolved");
  });

  it("supports exact aliases and explicit ignored aliases", () => {
    const configuredResolver = createModuleResolver({
      rootDirectory: configured.directory,
      aliases: { only$: join(configured.directory, "src/value.ts"), absent: false },
    });
    expect(configuredResolver.resolve("only", configured.importer).kind).toBe("file");
    expect(configuredResolver.resolve("only/child", configured.importer).kind).toBe("unresolved");
    expect(configuredResolver.resolve("absent", configured.importer)).toEqual({
      kind: "ignored",
      specifier: "absent",
    });
  });

  it("can explicitly disable tsconfig paths", () => {
    const configuredResolver = createModuleResolver({
      rootDirectory: configured.directory,
      tsconfigPath: false,
    });
    expect(configuredResolver.resolve("exact", configured.importer).kind).toBe("unresolved");
  });
});

it("uses a sibling jsconfig when the requested default tsconfig is absent", () => {
  const configured = createResolverProject();
  configured.write("jsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
  });
  const target = configured.write("src/value.js", "export {};");
  const configuredResolver = createModuleResolver({
    rootDirectory: configured.directory,
    tsconfigPath: "tsconfig.json",
  });
  expect(configuredResolver.resolve("@/value", configured.importer)).toEqual({
    kind: "file",
    id: target,
  });
});

it.each(["missing", "malformed", "cyclic"])(
  "does not hide a %s explicit tsconfig behind ordinary resolution",
  (mode) => {
    const configured = createResolverProject();
    configured.write("src/value.js", "export {};");
    if (mode === "malformed") configured.write("tsconfig.json", "{ invalid json");
    if (mode === "cyclic") configured.write("tsconfig.json", { extends: "./tsconfig.json" });
    const configuredResolver = createModuleResolver({
      rootDirectory: configured.directory,
      tsconfigPath: "tsconfig.json",
    });
    expect(configuredResolver.resolve("./value.js", configured.importer)).toMatchObject({
      kind: "unresolved",
      error: expect.stringMatching(/tsconfig/i),
    });
  },
);

it("refreshes missing files, package entries, and removals after clearCache", () => {
  const mutable = createResolverProject();
  const mutableResolver = createModuleResolver({ rootDirectory: mutable.directory });
  expect(mutableResolver.resolve("./later", mutable.importer).kind).toBe("unresolved");
  const later = mutable.write("src/later.ts", "export {};");
  mutableResolver.clearCache();
  expect(mutableResolver.resolve("./later", mutable.importer)).toEqual({ kind: "file", id: later });
  mutable.write("node_modules/changing/package.json", { exports: "./first.js" });
  mutable.write("node_modules/changing/first.js", "export {};");
  const second = mutable.write("node_modules/changing/second.js", "export {};");
  expect(mutableResolver.resolve("changing", mutable.importer).kind).toBe("file");
  mutable.write("node_modules/changing/package.json", { exports: "./second.js" });
  mutableResolver.clearCache();
  expect(mutableResolver.resolve("changing", mutable.importer)).toEqual({
    kind: "file",
    id: second,
  });
  rmSync(later);
  mutableResolver.clearCache();
  expect(mutableResolver.resolve("./later", mutable.importer).kind).toBe("unresolved");
});

it("does not mix roots or importers sharing the same specifier", () => {
  const first = createResolverProject();
  const second = createResolverProject();
  for (const current of [first, second]) current.write("src/value.ts", "export {};");
  const isolated = createModuleResolver({ rootDirectory: first.directory });
  expect(isolated.resolve("./value", first.importer)).toEqual({
    kind: "file",
    id: join(first.directory, "src/value.ts"),
  });
  expect(isolated.resolve("./value", second.importer)).toEqual({
    kind: "file",
    id: join(second.directory, "src/value.ts"),
  });
});

it.each([false, true])(
  "resolves workspace symlinks with preserveSymlinks=%s",
  (preserveSymlinks) => {
    const workspace = createResolverProject();
    workspace.write("packages/linked/package.json", { name: "linked", exports: "./index.js" });
    workspace.write("packages/linked/index.js", "export {};");
    workspace.write("node_modules/.keep", "");
    symlinkSync(
      join(workspace.directory, "packages/linked"),
      join(workspace.directory, "node_modules/linked"),
      "dir",
    );
    const workspaceResolver = createModuleResolver({
      rootDirectory: workspace.directory,
      preserveSymlinks,
    });
    const target = preserveSymlinks ? "node_modules/linked/index.js" : "packages/linked/index.js";
    expect(workspaceResolver.resolve("linked", workspace.importer)).toEqual({
      kind: "file",
      id: join(workspace.directory, target),
    });
  },
);

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createModuleResolver, readTsconfigPaths } from "@bippy/parser";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { findWorkspacePackages, linkWorkspacePackages } from "../../src/corpus/workspaces.js";

const temporaryDirectories: string[] = [];

const createTree = (files: Record<string, string>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bippy-parser-")));
  temporaryDirectories.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }
  return root;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe("readTsconfigPaths", () => {
  it("reads paths and baseUrl from JSON with comments and trailing commas", () => {
    const root = createTree({
      "tsconfig.json": `{
        // extends a config that is not installed
        "extends": "@acme/tsconfig/base.json",
        "compilerOptions": {
          "baseUrl": "./app",
          "paths": {
            "~/*": ["modules/*"], /* wildcard */
            "@lib": ["lib/index.ts"],
          },
        },
      }`,
    });
    expect(readTsconfigPaths(join(root, "tsconfig.json"))).toEqual({
      alias: {
        "~/*": [join(root, "app/modules/*")],
        "@lib$": [join(root, "app/lib/index.ts")],
      },
      baseUrl: join(root, "app"),
    });
  });

  it("resolves paths against the tsconfig directory without a baseUrl", () => {
    const root = createTree({
      "web/tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
    });
    expect(readTsconfigPaths(join(root, "web/tsconfig.json"))).toEqual({
      alias: { "@/*": [join(root, "web/src/*")] },
      baseUrl: null,
    });
  });

  it("yields no mapping for configs it cannot read", () => {
    const root = createTree({ "tsconfig.json": `{ "compilerOptions": ` });
    expect(readTsconfigPaths(join(root, "tsconfig.json"))).toEqual({ alias: {}, baseUrl: null });
  });
});

describe("createModuleResolver", () => {
  it("applies tsconfig paths when the extended config is unavailable", () => {
    const root = createTree({
      "tsconfig.json": `{
        "extends": "@acme/tsconfig/nextjs.json",
        "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["modules/*"], "@lib": ["lib/index.ts"] } }
      }`,
      "modules/util.ts": "",
      "lib/index.ts": "",
      "components/Button.tsx": "",
      "pages/index.tsx": "",
    });
    const resolver = createModuleResolver({ rootDirectory: root });
    const fromFile = join(root, "pages/index.tsx");
    const resolvePath = (specifier: string): string | null =>
      resolver.resolve(fromFile, specifier)?.path ?? null;
    expect(resolvePath("~/util")).toBe(join(root, "modules/util.ts"));
    expect(resolvePath("@lib")).toBe(join(root, "lib/index.ts"));
    expect(resolvePath("components/Button")).toBe(join(root, "components/Button.tsx"));
    expect(resolvePath("../lib")).toBe(join(root, "lib/index.ts"));
    expect(resolvePath("@lib/nested")).toBeNull();
  });

  it("searches module directories ahead of node_modules and reports linked packages as internal", () => {
    const root = createTree({
      "packages/ui/package.json": `{ "name": "@acme/ui", "main": "./index.tsx" }`,
      "packages/ui/index.tsx": "",
      "packages/ui/button.tsx": "",
      "apps/web/src/app.tsx": "",
    });
    const links = createTree({});
    expect(linkWorkspacePackages(root, links)).toBeNull();
    writeFileSync(join(root, "package.json"), `{ "workspaces": ["packages/*"] }`);
    const modulesDirectory = linkWorkspacePackages(root, links);
    expect(modulesDirectory).toBe(join(links, "node_modules"));
    const resolver = createModuleResolver({
      rootDirectory: root,
      moduleDirectories: [modulesDirectory ?? ""],
    });
    const fromFile = join(root, "apps/web/src/app.tsx");
    expect(resolver.resolve(fromFile, "@acme/ui")).toEqual({
      path: join(root, "packages/ui/index.tsx"),
      isExternal: false,
      packageName: null,
    });
    expect(resolver.resolve(fromFile, "@acme/ui/button")?.path).toBe(
      join(root, "packages/ui/button.tsx"),
    );
  });

  it("does not resolve packages from node_modules above the project root", () => {
    const outer = createTree({
      "node_modules/shared/package.json": `{ "name": "shared", "main": "./index.js" }`,
      "node_modules/shared/index.js": "",
      "project/node_modules/local/package.json": `{ "name": "local", "main": "./index.js" }`,
      "project/node_modules/local/index.js": "",
      "project/src/app.tsx": "",
    });
    const resolver = createModuleResolver({ rootDirectory: join(outer, "project") });
    const fromFile = join(outer, "project/src/app.tsx");
    expect(resolver.resolve(fromFile, "local")?.path).toBe(
      join(outer, "project/node_modules/local/index.js"),
    );
    expect(resolver.resolve(fromFile, "shared")).toBeNull();
  });
});

describe("findWorkspacePackages", () => {
  it("expands pnpm and package.json workspace globs, honouring negations", () => {
    const root = createTree({
      "pnpm-workspace.yaml": `packages:\n  - "apps/*"\n  - packages/**\n  - '!apps/api'\n\ncatalog:\n  react: ^19\n`,
      "package.json": `{ "workspaces": { "packages": ["tools/twenty-*"] } }`,
      "apps/web/package.json": `{ "name": "web" }`,
      "apps/api/package.json": `{ "name": "api" }`,
      "packages/ui/package.json": `{ "name": "@acme/ui" }`,
      "packages/ui/node_modules/dep/package.json": `{ "name": "dep" }`,
      "packages/features/auth/package.json": `{ "name": "@acme/auth" }`,
      "tools/twenty-cli/package.json": `{ "name": "twenty-cli" }`,
      "tools/other/package.json": `{ "name": "other" }`,
    });
    expect(
      findWorkspacePackages(root)
        .map((workspacePackage) => workspacePackage.name)
        .sort(),
    ).toEqual(["@acme/auth", "@acme/ui", "twenty-cli", "web"]);
  });
});

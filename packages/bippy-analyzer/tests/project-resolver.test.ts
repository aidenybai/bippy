import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { createServer } from "vite-plus";
import { build } from "esbuild";
import { createResolver, ResolverConfigurationError } from "../src/core.js";
import { createResolverProject } from "./helpers/resolver-project.js";

describe("project resolver", () => {
  it("discovers inherited TypeScript paths and preserves query identity", () => {
    const project = createResolverProject();
    project.write("tsconfig.base.json", {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });
    project.write("tsconfig.json", { extends: "./tsconfig.base.json" });
    const target = project.write("src/value.ts", "export const value = 42;");
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("@/value.js?raw#one", project.importer)).toEqual({
      kind: "file",
      id: `${target}?raw#one`,
    });
    expect(resolver.getConfiguration(project.importer).files).toEqual([
      join(project.directory, "tsconfig.json"),
    ]);
  });

  it("uses nearest jsconfig and keeps workspace aliases scoped", () => {
    const project = createResolverProject();
    project.write("tsconfig.json", {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });
    project.write("packages/ui/jsconfig.json", {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["components/*"] } },
    });
    const rootTarget = project.write("src/value.ts", "export {};");
    const nestedTarget = project.write("packages/ui/components/value.ts", "export {};");
    const importer = project.write("packages/ui/src/entry.ts", "export {};");
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("@/value", importer)).toEqual({ kind: "file", id: nestedTarget });
    expect(resolver.resolve("@/value", project.importer)).toEqual({ kind: "file", id: rootTarget });
  });

  it("uses rootDirs from the selected nested TypeScript configuration", () => {
    const project = createResolverProject();
    project.write("tsconfig.json", {});
    project.write("packages/ui/tsconfig.json", {
      compilerOptions: { rootDirs: ["src", "generated"] },
    });
    const importer = project.write("packages/ui/src/page.ts", "export {};");
    const target = project.write("packages/ui/generated/types.ts", "export {};");
    expect(
      createResolver({ rootDirectory: project.directory, platform: "browser" }).resolve(
        "./types",
        importer,
      ),
    ).toEqual({ kind: "file", id: target });
  });

  it("reads Vite alias constants and file URLs without loading the configuration", () => {
    const project = createResolverProject();
    const target = project.write("src/value.ts", "export {};");
    project.write(
      "vite.config.ts",
      `import {defineConfig} from 'vite'; import {fileURLToPath} from 'node:url'; import missingPlugin from 'not-installed'; const aliases = {'@': fileURLToPath(new URL('./src', import.meta.url))}; export default defineConfig({plugins: [missingPlugin()], resolve: {alias: aliases}});`,
    );
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("@/value", project.importer)).toEqual({ kind: "file", id: target });
    expect(resolver.getConfiguration(project.importer).diagnostics).toEqual([
      expect.stringContaining("plugins were not executed"),
    ]);
  });

  it("reads CommonJS webpack aliases, exact matches, arrays and ignored targets", () => {
    const project = createResolverProject();
    const target = project.write("src/value.ts", "export {};");
    project.write(
      "webpack.config.cjs",
      `const path = require('node:path'); module.exports = {resolve: {alias: {'exact$': path.resolve(__dirname, 'src/value.ts'), '@': [path.resolve(__dirname, 'missing'), path.join(__dirname, 'src')], disabled: false}}};`,
    );
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("exact", project.importer)).toEqual({ kind: "file", id: target });
    expect(resolver.resolve("exact/child", project.importer).kind).toBe("unresolved");
    expect(resolver.resolve("@/value", project.importer)).toEqual({ kind: "file", id: target });
    expect(resolver.resolve("disabled", project.importer)).toEqual({
      kind: "ignored",
      specifier: "disabled",
    });
  });

  it("lets a static bundler alias override TypeScript paths without hiding broken aliases", () => {
    const project = createResolverProject();
    project.write("tsconfig.json", {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });
    project.write("src/value.ts", "export {};");
    const target = project.write("browser/value.ts", "export {};");
    const configFile = project.write(
      "vite.config.ts",
      `export default {resolve: {alias: {'@': ${JSON.stringify(join(project.directory, "browser"))}}}};`,
    );
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("@/value", project.importer)).toEqual({ kind: "file", id: target });
    project.write(
      "vite.config.ts",
      `export default {resolve: {alias: {'@': ${JSON.stringify(join(project.directory, "missing"))}}}};`,
    );
    resolver.clearCache();
    expect(resolver.resolve("@/value", project.importer).kind).toBe("unresolved");
    expect(resolver.getConfiguration(project.importer).files).toContain(configFile);
  });

  it("selects platform, mode and request kind without a cross-platform fallback", () => {
    const project = createResolverProject();
    project.write("node_modules/conditional/package.json", {
      name: "conditional",
      exports: {
        browser: {
          development: "./development.js",
          import: "./browser.js",
          require: "./browser.cjs",
        },
        node: "./node.js",
      },
    });
    const development = project.write("node_modules/conditional/development.js", "export {};");
    const browser = project.write("node_modules/conditional/browser.js", "export {};");
    const commonjs = project.write("node_modules/conditional/browser.cjs", "module.exports = 1;");
    const node = project.write("node_modules/conditional/node.js", "export {};");
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("conditional", project.importer)).toEqual({
      kind: "file",
      id: browser,
    });
    expect(resolver.resolve("conditional", project.importer, { kind: "require" })).toEqual({
      kind: "file",
      id: commonjs,
    });
    expect(
      createResolver({
        rootDirectory: project.directory,
        platform: "browser",
        mode: "development",
      }).resolve("conditional", project.importer),
    ).toEqual({ kind: "file", id: development });
    expect(
      createResolver({ rootDirectory: project.directory, platform: "node" }).resolve(
        "conditional",
        project.importer,
      ),
    ).toEqual({ kind: "file", id: node });
    project.write("node_modules/browser-only/package.json", {
      name: "browser-only",
      exports: { browser: "./index.js" },
    });
    project.write("node_modules/browser-only/index.js", "export {};");
    expect(
      createResolver({ rootDirectory: project.directory, platform: "node" }).resolve(
        "browser-only",
        project.importer,
      ).kind,
    ).toBe("unresolved");
  });

  it("keeps package imports, builtins and browser maps in the same API", () => {
    const project = createResolverProject();
    project.write("package.json", {
      name: "fixture",
      imports: { "#value": "./src/value.ts" },
      browser: { "./src/server.ts": false },
    });
    const target = project.write("src/value.ts", "export {};");
    project.write("src/server.ts", "export {};");
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("#value", project.importer)).toEqual({ kind: "file", id: target });
    expect(resolver.resolve("node:fs", project.importer)).toEqual({
      kind: "builtin",
      id: "node:fs",
    });
    expect(resolver.resolve("./server.ts", project.importer)).toEqual({
      kind: "ignored",
      specifier: "./server.ts",
    });
  });

  it("rejects declarations and keeps virtual requests unresolved", () => {
    const project = createResolverProject();
    project.write("src/value.d.ts", "export declare const value: number;");
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("./value.d.ts", project.importer)).toEqual({
      kind: "unresolved",
      specifier: "./value.d.ts",
      error: "Declaration files are not executable modules",
    });
    expect(resolver.resolve("\0virtual", project.importer).kind).toBe("unresolved");
  });

  it("reports dynamic configuration instead of evaluating it or guessing a target", () => {
    const project = createResolverProject();
    const marker = join(project.directory, "executed");
    project.write(
      "vite.config.ts",
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad'); export default {resolve: {alias: {'@': './src'}}};`,
    );
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("@/value", project.importer)).toEqual({
      kind: "unresolved",
      specifier: "@/value",
      error: expect.stringContaining("side effects"),
    });
    expect(existsSync(marker)).toBe(false);
  });

  it.each([
    "export default () => ({resolve: {alias: {'@': './src'}}});",
    "export default {webpack(config) {return config;}};",
    "export default {resolve: {alias: [{find: /^@/, replacement: './src'}]}};",
    "const config = {}; Object.assign(config, {resolve: {alias: {'@': './src'}}}); export default config;",
    "export default {resolve: {plugins: []}};",
    "export default {resolve: {alias: {broken: ",
  ])("retains unsupported or malformed configuration errors: %s", (configuration) => {
    const project = createResolverProject();
    const configFile = project.write("vite.config.ts", configuration);
    const result = createResolver({
      rootDirectory: project.directory,
      platform: "browser",
    }).resolve("./app.tsx", project.importer);
    expect(result).toEqual({
      kind: "unresolved",
      specifier: "./app.tsx",
      error: expect.stringContaining(configFile),
    });
  });

  it("requires an explicit choice when multiple toolchain configurations exist", () => {
    const project = createResolverProject();
    const configFile = project.write("vite.config.ts", "export default {};");
    project.write("webpack.config.js", "module.exports = {};");
    expect(
      createResolver({ rootDirectory: project.directory, platform: "browser" }).resolve(
        "./app.tsx",
        project.importer,
      ),
    ).toEqual({
      kind: "unresolved",
      specifier: "./app.tsx",
      error: expect.stringContaining("Multiple toolchain configurations"),
    });
    expect(
      createResolver({ rootDirectory: project.directory, platform: "browser", configFile }).resolve(
        "./app.tsx",
        project.importer,
      ),
    ).toEqual({ kind: "file", id: project.importer });
  });

  it("preserves ordered alias matches, wildcard suffixes and chained aliases", async () => {
    const project = createResolverProject();
    const first = project.write("first/special/value.ts", "export {};");
    project.write("second/value.ts", "export {};");
    const wildcard = project.write("generated/card.ts", "export {};");
    project.write(
      "vite.config.ts",
      `export default {resolve: {alias: [{find: '@', replacement: ${JSON.stringify(join(project.directory, "first"))}}, {find: '@/special', replacement: ${JSON.stringify(join(project.directory, "second"))}}, {find: 'view/*.component', replacement: ${JSON.stringify(join(project.directory, "generated/*.ts"))}}, {find: 'chained', replacement: 'view/card.component'}]}};`,
    );
    const resolver = createResolver({ rootDirectory: project.directory, platform: "browser" });
    expect(resolver.resolve("@/special/value", project.importer)).toEqual({
      kind: "file",
      id: first,
    });
    const server = await createServer({
      root: project.directory,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      resolve: {
        alias: [
          { find: "@", replacement: join(project.directory, "first") },
          { find: "@/special", replacement: join(project.directory, "second") },
        ],
      },
    });
    try {
      expect(
        (
          await server.environments.client.pluginContainer.resolveId(
            "@/special/value",
            project.importer,
          )
        )?.id,
      ).toBe(first);
    } finally {
      await server.close();
    }
    expect(resolver.resolve("view/card.component?raw", project.importer).kind).toBe("unresolved");
    expect(resolver.resolve("chained", project.importer).kind).toBe("unresolved");
    const patterns = createResolver({
      rootDirectory: project.directory,
      platform: "browser",
      configFile: false,
      alias: {
        "view/*.component": [join(project.directory, "generated/*.ts")],
        chained: ["view/card.component"],
      },
    });
    expect(patterns.resolve("view/card.component?raw", project.importer)).toEqual({
      kind: "file",
      id: `${wildcard}?raw`,
    });
    expect(patterns.resolve("chained", project.importer)).toEqual({ kind: "file", id: wildcard });
    const cyclic = createResolver({
      rootDirectory: project.directory,
      platform: "browser",
      configFile: false,
      alias: { first: ["second"], second: ["first"] },
    });
    expect(cyclic.resolve("first", project.importer)).toEqual({
      kind: "unresolved",
      specifier: "first",
      error: expect.stringContaining("Circular alias"),
    });
  });

  it("uses the esbuild working directory and longest matching package alias", async () => {
    const project = createResolverProject();
    const target = project.write("node_modules/replacement/index.js", "export {};");
    project.write("node_modules/replacement/package.json", {
      name: "replacement",
      main: "index.js",
    });
    project.write("src/node_modules/replacement/index.js", "export {};");
    project.write("src/node_modules/replacement/package.json", {
      name: "replacement",
      main: "index.js",
    });
    project.write(
      "esbuild.config.ts",
      `export default {alias: {'original': 'missing', 'original/specific': 'replacement'}};`,
    );
    const entry = project.write("src/entry.ts", 'import "original/specific";');
    const bundle = await build({
      absWorkingDir: project.directory,
      entryPoints: [entry],
      bundle: true,
      write: false,
      metafile: true,
      platform: "browser",
      alias: { original: "missing", "original/specific": "replacement" },
    });
    expect(
      Object.keys(bundle.metafile.inputs).map((file) => join(project.directory, file)),
    ).toContain(target);
    expect(Object.keys(bundle.metafile.inputs)).not.toContain(
      "src/node_modules/replacement/index.js",
    );
    expect(
      createResolver({ rootDirectory: project.directory, platform: "browser" }).resolve(
        "original/specific",
        project.importer,
      ),
    ).toEqual({ kind: "file", id: target });
  });

  it("retains import and require conditions when reading Vite conditions", () => {
    const project = createResolverProject();
    project.write(
      "vite.config.ts",
      `export default {resolve: {conditions: ['custom', 'development|production']}};`,
    );
    const resolver = createResolver({
      rootDirectory: project.directory,
      platform: "browser",
      mode: "development",
    });
    expect(resolver.getConfiguration(project.importer).options.conditionNames).toEqual([
      "custom",
      "development",
      "import",
    ]);
    expect(
      resolver.getConfiguration(project.importer, { kind: "require" }).options.conditionNames,
    ).toEqual(["custom", "development", "require"]);
  });

  it("resolves static Next Turbopack aliases relative to the project", () => {
    const project = createResolverProject();
    project.write("next.config.ts", `export default {turbopack: {resolveAlias: {'@': './src'}}};`);
    const target = project.write("src/value.ts", "export {};");
    expect(
      createResolver({ rootDirectory: project.directory, platform: "browser" }).resolve(
        "@/value",
        project.importer,
      ),
    ).toEqual({ kind: "file", id: target });
  });

  it("supports explicit policies and copies configuration metadata", () => {
    const project = createResolverProject();
    project.write("vite.config.ts", "export default () => { throw new Error('not loaded'); };");
    const target = project.write("src/value.ts", "export {};");
    const resolver = createResolver({
      rootDirectory: project.directory,
      platform: "browser",
      configFile: false,
      alias: { "@": [join(project.directory, "src")] },
    });
    const configuration = resolver.getConfiguration(project.importer);
    configuration.options.extensions.length = 0;
    expect(resolver.resolve("@/value", project.importer)).toEqual({ kind: "file", id: target });
    expect(() => createResolver({ rootDirectory: "relative", platform: "browser" })).toThrow(
      ResolverConfigurationError,
    );
  });
});

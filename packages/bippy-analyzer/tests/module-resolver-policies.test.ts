import * as fs from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { ResolverFactory } from "enhanced-resolve";
import { getMainField } from "next/dist/build/webpack-config-rules/resolve.js";
import { JsConfigPathsPlugin } from "next/dist/build/webpack/plugins/jsconfig-paths-plugin.js";
import { createModuleResolver, type ModuleResolverOptions } from "../src/module-resolver.js";
import { createWebpackModuleResolver } from "../src/webpack-module-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

const basePolicy = {
  conditionNames: ["import"],
  extensions: [".js"],
  mainFields: ["main"],
} satisfies ModuleResolverOptions;

it("does not silently enable TypeScript, browser fields, module conditions, or paths", () => {
  const project = createResolverProject();
  project.write("tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { mapped: ["src/value.ts"] } },
  });
  project.write("src/value.ts", "export {};");
  project.write("node_modules/conditional/package.json", {
    exports: { browser: "./browser.js", module: "./module.js", default: "./default.js" },
  });
  for (const name of ["browser", "module", "default"])
    project.write(`node_modules/conditional/${name}.js`, "export {};");
  const resolver = createModuleResolver(basePolicy);
  expect(resolver.resolve("mapped", project.importer).kind).toBe("unresolved");
  expect(resolver.resolve("./value", project.importer).kind).toBe("unresolved");
  expect(resolver.resolve("conditional", project.importer)).toEqual({
    kind: "file",
    id: join(project.directory, "node_modules/conditional/default.js"),
  });
});

it.each([
  {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".scss", ".css", ".less"],
    target: "src/schema/index.ts",
  },
  { extensions: [".js", ".json"], target: "src/schema.json" },
])(
  "respects the PostHog schema collision's configured extensions: $target",
  async ({ extensions, target }) => {
    const project = createResolverProject();
    project.write("src/schema.json", {});
    project.write("src/schema/index.ts", "export const NodeKind = 1;");
    const options = { ...basePolicy, extensions };
    const expected = { kind: "file", id: join(project.directory, target) };
    expect(createModuleResolver(options).resolve("./schema", project.importer)).toEqual(expected);
    const webpack = createWebpackModuleResolver(
      ResolverFactory.createResolver({ ...options, fileSystem: fs }),
    );
    expect(await webpack.resolve("./schema", project.importer)).toEqual(expected);
  },
);

it.each([
  { compiler: "client", preferEsm: false, target: "browser.js" },
  { compiler: "server", preferEsm: false, target: "main.js" },
  { compiler: "server", preferEsm: true, target: "module.js" },
] satisfies Array<{ compiler: "client" | "server"; preferEsm: boolean; target: string }>)(
  "matches Next's installed main-field policy for $compiler/preferEsm=$preferEsm",
  async ({ compiler, preferEsm, target }) => {
    const project = createResolverProject();
    project.write("node_modules/entries/package.json", {
      browser: "./browser.js",
      module: "./module.js",
      main: "./main.js",
    });
    for (const name of ["browser", "module", "main"])
      project.write(`node_modules/entries/${name}.js`, "export {};");
    const options = { ...basePolicy, mainFields: getMainField(compiler, preferEsm) };
    const expected = {
      kind: "file",
      id: join(project.directory, `node_modules/entries/${target}`),
    };
    expect(createModuleResolver(options).resolve("entries", project.importer)).toEqual(expected);
    expect(
      await createWebpackModuleResolver(
        ResolverFactory.createResolver({ ...options, fileSystem: fs }),
      ).resolve("entries", project.importer),
    ).toEqual(expected);
  },
);

it("delegates to Next's actual paths plugin, including fallback targets and ignored aliases", async () => {
  const project = createResolverProject();
  const target = project.write("src/value.ts", "export {};");
  const webpack = ResolverFactory.createResolver({
    fileSystem: fs,
    extensions: [".ts"],
    alias: { ignored: false },
    plugins: [
      new JsConfigPathsPlugin(
        { "@app/*": ["missing/*", "src/*"] },
        { baseUrl: project.directory, isImplicit: false },
      ),
    ],
  });
  const resolver = createWebpackModuleResolver(webpack);
  expect(await resolver.resolve("@app/value", project.importer)).toEqual({
    kind: "file",
    id: target,
  });
  expect(await resolver.resolve("@app/missing", project.importer)).toMatchObject({
    kind: "unresolved",
  });
  expect(await resolver.resolve("ignored", project.importer)).toEqual({
    kind: "ignored",
    specifier: "ignored",
  });
});

it("copies nested policy inputs and separates aliases from TypeScript precedence", () => {
  const project = createResolverProject();
  const aliasTarget = project.write("src/alias.ts", "export {};");
  const configTarget = project.write("src/config.ts", "export {};");
  const configFile = project.write("tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { selected: ["src/config.ts"] } },
  });
  const options = { ...basePolicy, alias: { selected: [aliasTarget] }, tsconfig: { configFile } };
  const configFirst = createModuleResolver(options);
  const aliasFirst = createModuleResolver({ ...options, aliasPrecedence: "alias" });
  options.alias.selected[0] = "/missing.ts";
  expect(configFirst.resolve("selected", project.importer)).toEqual({
    kind: "file",
    id: configTarget,
  });
  expect(aliasFirst.resolve("selected", project.importer)).toEqual({
    kind: "file",
    id: aliasTarget,
  });
});

it("does not invent a jsconfig fallback for an explicitly missing configuration", () => {
  const project = createResolverProject();
  project.write("jsconfig.json", {});
  project.write("src/value.js", "export {};");
  const resolver = createModuleResolver({
    ...basePolicy,
    tsconfig: { configFile: join(project.directory, "tsconfig.json") },
  });
  expect(resolver.resolve("./value.js", project.importer)).toMatchObject({
    kind: "unresolved",
    error: expect.stringContaining("tsconfig"),
  });
});

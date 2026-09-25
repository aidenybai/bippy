import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { createBundlerFixtureResolver as createModuleResolver } from "./helpers/bundler-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

const conditional = createResolverProject();
conditional.write("node_modules/target/package.json", {
  exports: {
    ".": {
      "react-server": "./react-server.js",
      browser: { import: "./browser-import.js", require: "./browser-require.js" },
      node: { import: "./node-import.js", require: "./node-require.js" },
    },
    "./mode": { production: "./production.js", development: "./development.js" },
  },
});
for (const name of [
  "react-server",
  "browser-import",
  "browser-require",
  "node-import",
  "node-require",
  "production",
  "development",
])
  conditional.write(
    `node_modules/target/${name}.js`,
    "throw new Error('Resolution must not execute this module');",
  );

it("keeps import/require and browser/server results separate in one resolver", () => {
  const resolver = createModuleResolver({ rootDirectory: conditional.directory });
  for (const environment of ["client", "server"] satisfies Array<"client" | "server">) {
    for (const kind of ["esm", "commonjs"] satisfies Array<"esm" | "commonjs">) {
      const result = resolver.resolve("target", conditional.importer, kind, environment);
      expect(result).toEqual({
        kind: "file",
        id: join(
          conditional.directory,
          `node_modules/target/${environment === "client" ? "browser" : "node"}-${kind === "esm" ? "import" : "require"}.js`,
        ),
      });
      expect(resolver.resolve("target", conditional.importer, kind, environment)).toEqual(result);
    }
  }
  resolver.clearCache();
  expect(resolver.resolve("target", conditional.importer)).toEqual({
    kind: "file",
    id: join(conditional.directory, "node_modules/target/browser-import.js"),
  });
});

it.each([undefined, "development", "test", "production"])(
  "selects an explicit NODE_ENV policy for %s",
  (nodeEnvironment) => {
    const resolver = createModuleResolver({
      rootDirectory: conditional.directory,
      nodeEnvironment,
    });
    expect(resolver.resolve("target/mode", conditional.importer)).toEqual({
      kind: "file",
      id: join(
        conditional.directory,
        `node_modules/target/${nodeEnvironment === "production" ? "production" : "development"}.js`,
      ),
    });
  },
);

it("enables react-server only when the caller supplies that condition", () => {
  const resolver = createModuleResolver({
    rootDirectory: conditional.directory,
    conditions: ["react-server"],
  });
  expect(resolver.resolve("target", conditional.importer, "esm", "server")).toEqual({
    kind: "file",
    id: join(conditional.directory, "node_modules/target/react-server.js"),
  });
});

it("does not let caller mutations silently change cached resolution policy", () => {
  const conditions = ["react-server"];
  const aliases = { alias: join(conditional.directory, "node_modules/target/production.js") };
  const resolver = createModuleResolver({
    rootDirectory: conditional.directory,
    conditions,
    aliases,
  });
  conditions.length = 0;
  aliases.alias = join(conditional.directory, "node_modules/target/development.js");
  expect(resolver.resolve("target", conditional.importer, "esm", "server")).toEqual({
    kind: "file",
    id: join(conditional.directory, "node_modules/target/react-server.js"),
  });
  expect(resolver.resolve("alias", conditional.importer)).toEqual({
    kind: "file",
    id: join(conditional.directory, "node_modules/target/production.js"),
  });
});

it("does not reuse one nested dependency's resolution for another importer", () => {
  const project = createResolverProject();
  const firstImporter = project.write("packages/first/src/app.ts", "export {};");
  const secondImporter = project.write("packages/second/src/app.ts", "export {};");
  for (const name of ["first", "second"]) {
    project.write(`packages/${name}/node_modules/dep/package.json`, { main: "index.js" });
    project.write(`packages/${name}/node_modules/dep/index.js`, "module.exports = 1;");
  }
  const resolver = createModuleResolver({ rootDirectory: project.directory });
  for (const [name, importer] of [
    ["first", firstImporter],
    ["second", secondImporter],
    ["first", firstImporter],
  ])
    expect(resolver.resolve("dep", importer)).toEqual({
      kind: "file",
      id: join(project.directory, `packages/${name}/node_modules/dep/index.js`),
    });
});

it("discovers the nearest tsconfig for each importer", () => {
  const project = createResolverProject();
  project.write("tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { target: ["root.ts"] } },
  });
  project.write("root.ts", "export {};");
  const rootImporter = project.importer;
  const nestedImporter = project.write("nested/app.ts", "export {};");
  project.write("nested/tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { target: ["nested.ts"] } },
  });
  project.write("nested/nested.ts", "export {};");
  const resolver = createModuleResolver({ rootDirectory: project.directory });
  expect(resolver.resolve("target", rootImporter)).toEqual({
    kind: "file",
    id: join(project.directory, "root.ts"),
  });
  expect(resolver.resolve("target", nestedImporter)).toEqual({
    kind: "file",
    id: join(project.directory, "nested/nested.ts"),
  });
});

it("follows project references from an explicit solution tsconfig", () => {
  const project = createResolverProject();
  project.write("tsconfig.json", {
    files: [],
    references: [{ path: "./packages/first" }, { path: "./packages/second" }],
  });
  const resolver = createModuleResolver({
    rootDirectory: project.directory,
    tsconfigPath: "tsconfig.json",
  });
  for (const name of ["first", "second"]) {
    project.write(`packages/${name}/tsconfig.json`, {
      compilerOptions: { composite: true, baseUrl: ".", paths: { target: ["value.ts"] } },
    });
    project.write(`packages/${name}/value.ts`, "export {};");
    project.write(`packages/${name}/app.ts`, "export {};");
  }
  for (const name of ["first", "second"])
    expect(resolver.resolve("target", join(project.directory, `packages/${name}/app.ts`))).toEqual({
      kind: "file",
      id: join(project.directory, `packages/${name}/value.ts`),
    });
});

it("does not read process NODE_PATH as a hidden dependency source", () => {
  const project = createResolverProject();
  project.write("global-deps/hidden/package.json", { main: "index.js" });
  project.write("global-deps/hidden/index.js", "export {};");
  vi.stubEnv("NODE_PATH", join(project.directory, "global-deps"));
  try {
    expect(
      createModuleResolver({ rootDirectory: project.directory }).resolve("hidden", project.importer)
        .kind,
    ).toBe("unresolved");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("does not fall back from malformed package metadata to a visible index.js", () => {
  const project = createResolverProject();
  project.write("node_modules/broken/package.json", "{not JSON");
  project.write("node_modules/broken/index.js", "export {};");
  expect(
    createModuleResolver({ rootDirectory: project.directory }).resolve("broken", project.importer),
  ).toMatchObject({ kind: "unresolved", error: expect.any(String) });
});

it("keeps explicit browser mappings out of the server profile", () => {
  const project = createResolverProject();
  project.write("node_modules/mapped/package.json", {
    main: "index.js",
    browser: { "./index.js": false },
  });
  const target = project.write("node_modules/mapped/index.js", "export {};");
  const resolver = createModuleResolver({ rootDirectory: project.directory });
  expect(resolver.resolve("mapped", project.importer)).toEqual({
    kind: "ignored",
    specifier: "mapped",
  });
  expect(resolver.resolve("mapped", project.importer, "esm", "server")).toEqual({
    kind: "file",
    id: target,
  });
});

it("does not turn a broken builtin alias into permission to load native code", () => {
  const project = createResolverProject();
  const resolver = createModuleResolver({
    rootDirectory: project.directory,
    aliases: { fs: join(project.directory, "missing.js") },
  });
  expect(resolver.resolve("fs", project.importer).kind).toBe("unresolved");
  expect(resolver.resolve("fs", project.importer, "esm", "server").kind).toBe("unresolved");
});

it("keeps query order, query values, and fragments as distinct module IDs", () => {
  const project = createResolverProject();
  const target = project.write("src/value.ts", "export {};");
  const resolver = createModuleResolver({ rootDirectory: project.directory });
  const suffixes = ["", "?raw", "?url", "?a=1&b=2", "?b=2&a=1", "?a=2&b=2", "#first", "#second"];
  const results = suffixes.map((suffix) =>
    resolver.resolve(`./value.ts${suffix}`, project.importer),
  );
  expect(results).toEqual(suffixes.map((suffix) => ({ kind: "file", id: target + suffix })));
});

it("resolves modules without executing source or project configuration", () => {
  const project = createResolverProject();
  const marker = join(project.directory, "executed");
  const contents = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('executed');`;
  project.write("vite.config.ts", contents);
  const target = project.write("src/value.ts", contents);
  expect(
    createModuleResolver({ rootDirectory: project.directory }).resolve("./value", project.importer),
  ).toEqual({ kind: "file", id: target });
  expect(existsSync(marker)).toBe(false);
});

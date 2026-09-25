import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { rollup } from "rollup";
import { createRollupModuleResolver } from "../src/rollup-module-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

it("does not pretend vanilla Rollup resolves npm packages or TypeScript extensions", async () => {
  expect.assertions(3);
  const project = createResolverProject();
  const entry = project.write("entry.js", "export const value = 1;");
  const target = project.write("local.js", "export {};");
  project.write("typed.ts", "export {};");
  project.write("node_modules/fixture/package.json", { main: "index.js" });
  project.write("node_modules/fixture/index.js", "export {};");
  const bundle = await rollup({
    input: entry,
    plugins: [
      {
        name: "check-native-rollup",
        async buildStart() {
          const resolver = createRollupModuleResolver(this);
          expect(await resolver.resolve("./local", entry)).toEqual({ kind: "file", id: target });
          expect(await resolver.resolve("fixture", entry)).toMatchObject({ kind: "unresolved" });
          expect(await resolver.resolve("./typed", entry)).toMatchObject({ kind: "unresolved" });
        },
      },
    ],
  });
  await bundle.close();
});

it("preserves a relative import rewritten to a package external, as in Zustand's build", async () => {
  expect.assertions(2);
  const project = createResolverProject();
  const entry = project.write("entry.js", 'export { value } from "./vanilla.js";');
  project.write("vanilla.js", "export const value = 1;");
  const bundle = await rollup({
    input: entry,
    external: ["fixture/vanilla"],
    plugins: [
      {
        name: "package-output-alias",
        resolveId(specifier, importer) {
          if (specifier === "./vanilla.js") return this.resolve("fixture/vanilla", importer);
        },
        async buildStart() {
          expect(
            await createRollupModuleResolver(this).resolve("./vanilla.js", entry, {
              skipSelf: false,
            }),
          ).toEqual({ kind: "external", id: "fixture/vanilla" });
        },
      },
    ],
  });
  try {
    const generated = await bundle.generate({ format: "esm" });
    expect(generated.output[0]).toMatchObject({ type: "chunk", imports: ["fixture/vanilla"] });
  } finally {
    await bundle.close();
  }
});

it("forwards import attributes, custom options, and entry status to actual Rollup plugins", async () => {
  expect.assertions(4);
  const project = createResolverProject();
  const entry = project.write("entry.js", "export const value = 1;");
  const bundle = await rollup({
    input: entry,
    plugins: [
      {
        name: "context-sensitive-fixture",
        resolveId: (specifier, _importer, options) => {
          if (
            specifier === "virtual:context" &&
            options.attributes.type === "json" &&
            options.isEntry &&
            options.custom?.fixture?.enabled
          )
            return "\0json-fixture";
          if (specifier === "plugin:failure") throw new Error("intentional Rollup failure");
          if (specifier === "plugin:builtin-name") return { id: "node:fs", external: false };
          if (specifier === "absolute-external")
            return { id: join(project.directory, "external.js"), external: "absolute" };
        },
      },
      {
        name: "check-options",
        async buildStart() {
          const resolver = createRollupModuleResolver(this);
          expect(
            await resolver.resolve("virtual:context", entry, {
              attributes: { type: "json" },
              isEntry: true,
              custom: { fixture: { enabled: true } },
            }),
          ).toEqual({ kind: "virtual", id: "\0json-fixture" });
          expect(await resolver.resolve("plugin:builtin-name", entry)).toEqual({
            kind: "virtual",
            id: "node:fs",
          });
          expect(await resolver.resolve("absolute-external", entry)).toEqual({
            kind: "external",
            id: join(project.directory, "external.js"),
            external: "absolute",
          });
          expect(await resolver.resolve("plugin:failure", entry)).toMatchObject({
            kind: "unresolved",
            error: expect.stringContaining("intentional Rollup failure"),
          });
        },
      },
    ],
  });
  await bundle.close();
});

it("preserves Rollup's explicit external policy instead of resolving the package anyway", async () => {
  expect.assertions(2);
  const project = createResolverProject();
  const entry = project.write("entry.js", "export const value = 1;");
  const bundle = await rollup({
    input: entry,
    external: ["fixture", "node:fs"],
    plugins: [
      {
        name: "check-externals",
        async buildStart() {
          const resolver = createRollupModuleResolver(this);
          expect(await resolver.resolve("fixture", entry)).toEqual({
            kind: "external",
            id: "fixture",
          });
          expect(await resolver.resolve("node:fs", entry)).toEqual({
            kind: "builtin",
            id: "node:fs",
          });
        },
      },
    ],
  });
  await bundle.close();
});

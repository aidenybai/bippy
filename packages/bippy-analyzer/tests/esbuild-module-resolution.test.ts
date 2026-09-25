import { join } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vite-plus/test";
import { createModuleResolver } from "../src/module-resolver.js";
import { createResolverProject } from "./helpers/resolver-project.js";

it("resolves esbuild package aliases from the working directory, not the importer", async () => {
  const project = createResolverProject();
  const entry = project.write("node_modules/nested/entry.js", 'export { value } from "original";');
  project.write("node_modules/replacement/package.json", { main: "index.js" });
  const rootTarget = project.write(
    "node_modules/replacement/index.js",
    'export const value = "root";',
  );
  project.write("node_modules/nested/node_modules/replacement/package.json", { main: "index.js" });
  const nestedTarget = project.write(
    "node_modules/nested/node_modules/replacement/index.js",
    'export const value = "nested";',
  );
  const result = await build({
    absWorkingDir: project.directory,
    entryPoints: [entry],
    alias: { original: "replacement" },
    bundle: true,
    write: false,
    metafile: true,
  });
  expect(
    Object.keys(result.metafile.inputs).map((path) => join(project.directory, path)),
  ).toContain(rootTarget);
  expect(
    Object.keys(result.metafile.inputs).map((path) => join(project.directory, path)),
  ).not.toContain(nestedTarget);
  expect(
    createModuleResolver({
      conditionNames: ["import"],
      extensions: [".js"],
      mainFields: ["main"],
      alias: { original: ["replacement"] },
    }).resolve("original", entry),
  ).toEqual({ kind: "file", id: nestedTarget });
});

it.each([
  { conditions: undefined, expected: "module" },
  { conditions: [], expected: "fallback" },
])(
  "distinguishes absent esbuild conditions from an explicitly empty list: $expected",
  async ({ conditions, expected }) => {
    const project = createResolverProject();
    const entry = project.write("entry.js", 'export { value } from "conditional";');
    project.write("node_modules/conditional/package.json", {
      exports: { module: "./module.js", default: "./fallback.js" },
    });
    for (const name of ["module", "fallback"])
      project.write(`node_modules/conditional/${name}.js`, `export const value = "${name}";`);
    const result = await build({
      absWorkingDir: project.directory,
      entryPoints: [entry],
      conditions,
      platform: "browser",
      bundle: true,
      write: false,
      metafile: true,
    });
    expect(Object.keys(result.metafile.inputs)).toContain(
      `node_modules/conditional/${expected}.js`,
    );
    expect(
      Object.keys(result.metafile.inputs).filter((path) =>
        path.includes("node_modules/conditional/"),
      ),
    ).toHaveLength(1);
  },
);

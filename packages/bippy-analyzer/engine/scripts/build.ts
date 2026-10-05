import { cp, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { transformAsync } from "@babel/core";
import { build } from "esbuild";
import engineMacros from "../vendor/engine262/scripts/transform.mts";
import { lowerGenerators } from "./lower-generators.ts";

const rootDirectory = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(rootDirectory, "vendor/engine262/src");
const license = await readFile(resolve(rootDirectory, "vendor/engine262/LICENSE"), "utf8");
const licenseDirectory = resolve(rootDirectory, "dist/licenses");
await mkdir(licenseDirectory, { recursive: true });
await cp(resolve(rootDirectory, "licenses"), licenseDirectory, { recursive: true });
await cp(
  resolve(rootDirectory, "vendor/engine262/LICENSE"),
  resolve(licenseDirectory, "engine262-mit.txt"),
);
await cp(
  resolve(rootDirectory, "vendor/test262/LICENSE"),
  resolve(licenseDirectory, "test262-bsd.txt"),
);

await build({
  absWorkingDir: rootDirectory,
  entryPoints: [resolve(sourceDirectory, "index.mts")],
  outfile: "dist/engine.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  banner: {
    js: `/*! Bippy engine fork, upstream f78bd24736daba0b2a69ea0bb4b7cffd3dedd54a\n${license}\n*/`,
  },
  plugins: [
    {
      name: "engine262-semantics",
      setup: (builder) => {
        builder.onResolve({ filter: /^#self$/ }, () => ({
          path: resolve(sourceDirectory, "index.mts"),
        }));
        builder.onLoad({ filter: /Case_Folding\/[CS]\/symbols\.js$/ }, ({ path }) => {
          const symbols: unknown = createRequire(import.meta.url)(path);
          if (!(symbols instanceof Map)) throw new Error(`Invalid Unicode map: ${path}`);
          return { contents: `export default new Map(${JSON.stringify([...symbols])});` };
        });
        builder.onLoad({ filter: /\.mts$/ }, async ({ path }) => {
          const result = await transformAsync(await readFile(path, "utf8"), {
            filename: path,
            configFile: false,
            babelrc: false,
            sourceMaps: "inline",
            plugins: [
              engineMacros,
              ["@babel/plugin-proposal-decorators", { version: "2023-11" }],
              ["@babel/plugin-transform-typescript", { allowDeclareFields: true }],
              "@babel/plugin-transform-explicit-resource-management",
            ],
          });
          if (!result?.code) throw new Error(`No engine build output for ${path}`);
          return {
            contents: await lowerGenerators(result.code, path),
            loader: "js",
            resolveDir: dirname(path),
          };
        });
      },
    },
  ],
});

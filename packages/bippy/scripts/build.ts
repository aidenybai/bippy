import { watch } from "node:fs";
import { $, Glob } from "bun";
import packageManifest from "../package.json";
import { generateReactInternals } from "./react-internals-generator";

const banner = `/**
 * @license bippy
 *
 * Copyright (c) Aiden Bai
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`;
// Syntax minification drops the "use no memo" directive in useFiber.
const minify = process.env.NODE_ENV === "production" && { identifiers: true, whitespace: true };
const relativeSpecifier = /(\b(?:from|import)\s*\(?\s*["']\.{1,2}\/[^"']+)(["'])/g;

const build = async (): Promise<void> => {
  await generateReactInternals({
    mode: process.env.CI && process.env.CI !== "false" ? "check" : "generate",
  });
  await $`rm -rf dist`;

  const moduleBuild = await Bun.build({
    banner,
    define: { "process.env.VERSION": JSON.stringify(packageManifest.version) },
    entrypoints: ["src/index.ts", "src/source.ts", "src/install-hook-only.ts"],
    external: ["react", "react-dom", "react-reconciler"],
    minify,
    outdir: "dist",
    plugins: [
      {
        name: "external-hook",
        setup: (builder) => {
          builder.onResolve({ filter: /^\.\/install-hook-only$/ }, () => ({
            external: true,
            path: "./install-hook-only.js",
          }));
        },
      },
    ],
    splitting: true,
  });

  // Bun splits chunks only for ESM, so each CommonJS file is converted from its ESM file.
  await Bun.build({
    entrypoints: moduleBuild.outputs.map((output) => output.path),
    format: "cjs",
    minify,
    naming: "[dir]/[name].cjs",
    outdir: "dist",
    packages: "external",
    plugins: [
      {
        name: "external-chunks",
        setup: (builder) => {
          builder.onResolve({ filter: /^\.\// }, (resolution) =>
            resolution.importer
              ? { external: true, path: resolution.path.replace(/\.js$/, ".cjs") }
              : undefined,
          );
        },
      },
    ],
  });

  // Node resolution needs file extensions, and CommonJS consumers need `.d.cts` files.
  await $`bun x tsc --project tsconfig.build.json`;
  for await (const path of new Glob("dist/**/*.d.ts").scan()) {
    const declaration = await Bun.file(path).text();
    await Bun.write(path, declaration.replace(relativeSpecifier, "$1.js$2"));
    await Bun.write(
      path.replace(/\.d\.ts$/, ".d.cts"),
      declaration.replace(relativeSpecifier, "$1.cjs$2"),
    );
  }
};

await build();

if (process.argv.includes("--watch")) {
  let pendingBuild = Promise.resolve();
  watch("src", { recursive: true }, () => {
    pendingBuild = pendingBuild.then(build).catch(console.error);
  });
}

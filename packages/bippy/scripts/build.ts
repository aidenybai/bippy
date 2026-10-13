import { rmSync, watch } from "node:fs";
import { resolve } from "node:path";
import { Glob } from "bun";
import { generateReactInternals } from "./react-internals-generator";

const packageDirectory = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(packageDirectory, "dist");
const packageManifest = await Bun.file(resolve(packageDirectory, "package.json")).json();
// Syntax minification drops the "use no memo" directive that opts useFiber out of React Compiler.
const minify =
  process.env.NODE_ENV === "production"
    ? { identifiers: true, syntax: false, whitespace: true }
    : false;
const banner = `/**
 * @license bippy
 *
 * Copyright (c) Aiden Bai
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`;

const relativeSpecifierPattern =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']+)\2/g;

const build = async (): Promise<void> => {
  await generateReactInternals({
    mode: process.env.CI && process.env.CI !== "false" ? "check" : "generate",
  });
  rmSync(outputDirectory, { force: true, recursive: true });

  const moduleBuild = await Bun.build({
    define: { "process.env.VERSION": JSON.stringify(packageManifest.version) },
    entrypoints: ["index.ts", "source.ts", "install-hook-only.ts"].map((entry) =>
      resolve(packageDirectory, "src", entry),
    ),
    external: ["react", "react-dom", "react-reconciler"],
    format: "esm",
    minify,
    outdir: outputDirectory,
    splitting: true,
    target: "browser",
  });

  // Bun splits chunks only for ESM, so each CommonJS file is converted from its ESM
  // counterpart. Both formats then share state through the same chunk boundaries.
  const commonBuild = await Bun.build({
    entrypoints: moduleBuild.outputs.map((output) => output.path),
    format: "cjs",
    minify,
    naming: "[dir]/[name].cjs",
    outdir: outputDirectory,
    packages: "external",
    plugins: [
      {
        name: "bippy-external-chunks",
        setup: (builder) => {
          builder.onResolve({ filter: /^\.{1,2}\// }, (resolution) =>
            resolution.importer
              ? { external: true, path: resolution.path.replace(/\.js$/, ".cjs") }
              : undefined,
          );
        },
      },
    ],
    target: "browser",
  });

  for (const output of [...moduleBuild.outputs, ...commonBuild.outputs]) {
    await Bun.write(output.path, `${banner}\n${await Bun.file(output.path).text()}`);
  }

  const declarationEmit = Bun.spawnSync(
    [
      "bun",
      "x",
      "tsc",
      "--project",
      "tsconfig.build.json",
      "--noEmit",
      "false",
      "--emitDeclarationOnly",
    ],
    { cwd: packageDirectory, stderr: "inherit", stdout: "inherit" },
  );
  if (!declarationEmit.success) throw new Error("Declaration emit failed");

  // Node resolution requires file extensions, and CommonJS consumers need `.d.cts` files.
  for await (const declarationPath of new Glob("**/*.d.ts").scan({
    absolute: true,
    cwd: outputDirectory,
  })) {
    const declaration = await Bun.file(declarationPath).text();
    for (const extension of ["js", "cjs"]) {
      await Bun.write(
        declarationPath.replace(/\.d\.ts$/, extension === "js" ? ".d.ts" : ".d.cts"),
        declaration.replace(
          relativeSpecifierPattern,
          (_match, prefix, quote, specifier) =>
            `${prefix}${quote}${specifier}.${extension}${quote}`,
        ),
      );
    }
  }
};

await build();

if (process.argv.includes("--watch")) {
  let pendingBuild = Promise.resolve();
  watch(resolve(packageDirectory, "src"), { recursive: true }, () => {
    pendingBuild = pendingBuild.then(build).catch(console.error);
  });
}

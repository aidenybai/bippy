import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";
import { reactInternalsPlugin } from "./scripts/react-internals-plugin.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const isContinuousIntegration = Boolean(process.env.CI && process.env.CI !== "false");
const licenseBanner = `/**
 * @license bippy
 *
 * Copyright (c) Aiden Bai
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`;

export default defineConfig({
  pack: {
    banner: licenseBanner,
    clean: true,
    define: {
      "process.env.VERSION": JSON.stringify(pkg.version),
    },
    deps: {
      alwaysBundle: ["@jridgewell/sourcemap-codec"],
      neverBundle: ["react", "react-dom", "react-reconciler"],
    },
    dts: true,
    entry: {
      index: "./src/index.ts",
      reconciler: "./src/reconciler/index.ts",
      source: "./src/source/index.ts",
      "install-hook-only": "./src/install-hook-only.ts",
    },
    env: {
      NODE_ENV: process.env.NODE_ENV ?? "development",
    },
    format: ["esm", "cjs"],
    hash: false,
    minify: process.env.NODE_ENV === "production" && !process.env.BIPPY_SOURCEMAP,
    outDir: "./dist",
    platform: "browser",
    plugins: [reactInternalsPlugin({ mode: isContinuousIntegration ? "check" : "generate" })],
    sourcemap: Boolean(process.env.BIPPY_SOURCEMAP),
    target: "esnext",
    treeshake: true,
  } satisfies PackUserConfig,
});

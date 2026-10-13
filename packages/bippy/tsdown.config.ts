import { defineConfig } from "tsdown";
import packageManifest from "./package.json";
import { generateReactInternals } from "./scripts/react-internals-generator";

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
  banner: licenseBanner,
  clean: true,
  define: {
    "process.env.VERSION": JSON.stringify(packageManifest.version),
  },
  deps: {
    onlyBundle: ["@jridgewell/sourcemap-codec"],
    neverBundle: ["react", "react-dom", "react-reconciler"],
  },
  dts: true,
  entry: {
    index: "./src/index.ts",
    source: "./src/source/index.ts",
    "install-hook-only": "./src/install-hook-only.ts",
  },
  env: {
    NODE_ENV: process.env.NODE_ENV ?? "development",
  },
  format: ["esm", "cjs"],
  hash: false,
  hooks: {
    "build:prepare": () =>
      generateReactInternals({ mode: isContinuousIntegration ? "check" : "generate" }),
  },
  minify: process.env.NODE_ENV === "production" && !process.env.BIPPY_SOURCEMAP,
  outDir: "./dist",
  platform: "browser",
  sourcemap: Boolean(process.env.BIPPY_SOURCEMAP),
  target: "esnext",
  treeshake: true,
  tsconfig: "./tsconfig.build.json",
});

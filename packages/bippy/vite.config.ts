import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const sharedPackOptions = {
  clean: false,
  hash: false,
  env: {
    NODE_ENV: process.env.NODE_ENV ?? "development",
  },
  define: {
    "process.env.VERSION": JSON.stringify(pkg.version),
  },
  deps: {
    neverBundle: ["react", "react-dom", "react-reconciler"],
    alwaysBundle: ["error-stack-parser-es", "@jridgewell/sourcemap-codec"],
  },
  minify: process.env.NODE_ENV === "production" && !process.env.BIPPY_SOURCEMAP,
  outDir: "./dist",
  platform: "browser",
  sourcemap: Boolean(process.env.BIPPY_SOURCEMAP),
  target: "esnext",
  treeshake: true,
};

export default defineConfig({
  pack: [
    {
      ...sharedPackOptions,
      clean: true,
      dts: true,
      entry: {
        index: "./src/index.ts",
        core: "./src/core.ts",
        "conditional-hooks": "./src/conditional-hooks.ts",
        source: "./src/source/index.ts",
        "react-refresh": "./src/react-refresh/index.ts",
        "install-hook-only": "./src/install-hook-only.ts",
      },
      format: ["esm", "cjs"],
    },
    {
      ...sharedPackOptions,
      entry: ["./src/index.ts"],
      format: ["iife"],
      globalName: "Bippy",
    },
    {
      ...sharedPackOptions,
      entry: ["./src/install-hook-only.ts"],
      format: ["iife"],
      globalName: "Bippy",
    },
  ],
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/types.ts"],
      provider: "istanbul",
      reporter: ["text", "json", "json-summary", "html"],
    },
    environment: "happy-dom",
  },
});

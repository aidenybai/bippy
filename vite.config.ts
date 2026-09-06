import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import { conformanceTestConfig } from "./packages/conformance/vite.config.js";

const reactDevToolsHookSources =
  "packages/conformance/fixtures/react-devtools-headless/fixtures/hook-sources/**";

export default defineConfig({
  staged: {
    "*.{js,ts,tsx}": "vp check --fix",
  },
  test: {
    ...conformanceTestConfig,
    projects: [
      ...(conformanceTestConfig.projects ?? []),
      resolve(import.meta.dirname, "packages/parser/vite.config.ts"),
    ],
  },
  fmt: {
    ignorePatterns: [
      "**/routeTree.gen.ts",
      "packages/bippy/src/react-internals/generated/**",
      "packages/parser/corpus/results.json",
      reactDevToolsHookSources,
    ],
    semi: true,
    singleQuote: false,
  },
  lint: {
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-var": "error",
      eqeqeq: "warn",
      "no-console": "off",
    },
    ignorePatterns: [
      "node_modules",
      "dist",
      "coverage",
      "pnpm-lock.yaml",
      "packages/parser/tests/components/compiled-*.js",
      reactDevToolsHookSources,
    ],
  },
});

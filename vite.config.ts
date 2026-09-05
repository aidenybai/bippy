import { defineConfig } from "vite-plus";
import { conformanceTestConfig } from "./packages/conformance/vite.config.js";

const reactDevToolsHookSources =
  "packages/conformance/fixtures/react-devtools-headless/fixtures/hook-sources/**";

export default defineConfig({
  staged: {
    "*.{js,ts,tsx}": "vp check --fix",
  },
  test: conformanceTestConfig,
  fmt: {
    ignorePatterns: [
      "**/routeTree.gen.ts",
      "packages/bippy/src/react-internals/generated/**",
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
      reactDevToolsHookSources,
    ],
  },
});

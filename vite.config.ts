import { defineConfig } from "vite-plus";

const reactDevToolsHookSources =
  "packages/bippy/tests/fixtures/react-devtools-headless/fixtures/hook-sources/**";
const reactCompilerSource = "packages/realize/src/react-compiler/**";

export default defineConfig({
  staged: {
    "*.{js,ts,tsx}": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "**/routeTree.gen.ts",
      "packages/bippy/src/react-internals/generated/**",
      reactDevToolsHookSources,
      reactCompilerSource,
      "packages/realize/viewer/src/generated/**",
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
      reactCompilerSource,
    ],
  },
});

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject, type TestUserConfig } from "vite-plus";

const parserDirectory = dirname(fileURLToPath(import.meta.url));
const bippyDirectory = resolve(parserDirectory, "../bippy");

export const parserTestProject = defineProject({
  root: parserDirectory,
  resolve: {
    alias: [
      { find: /^@bippy\/parser$/, replacement: resolve(parserDirectory, "src/index.ts") },
      {
        find: /^@bippy\/parser\/harness$/,
        replacement: resolve(parserDirectory, "src/harness/index.ts"),
      },
      { find: /^bippy$/, replacement: resolve(bippyDirectory, "src/index.ts") },
      {
        find: "bippy/install-hook-only",
        replacement: resolve(bippyDirectory, "src/install-hook-only.ts"),
      },
      { find: "bippy/source", replacement: resolve(bippyDirectory, "src/source/index.ts") },
      { find: /^@shared\//, replacement: `${resolve(parserDirectory, "tests/fixtures/shared")}/` },
      { find: /^~\//, replacement: `${resolve(parserDirectory, "tests/fixtures")}/` },
    ],
  },
  test: {
    name: "parser",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/fixtures/**"],
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
  },
});

export const parserTestConfig: TestUserConfig = {
  projects: [parserTestProject],
};

export default defineConfig({
  test: parserTestConfig,
});

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject, type TestUserConfig } from "vite-plus";

const conformanceDirectory = dirname(fileURLToPath(import.meta.url));
const bippyDirectory = resolve(conformanceDirectory, "../bippy");

export const conformanceTestConfig: TestUserConfig = {
  projects: [
    defineProject({
      root: conformanceDirectory,
      test: {
        name: "unit",
        include: ["tests/unit/**/*.test.{ts,tsx}"],
        environment: "happy-dom",
      },
    }),
    defineProject({
      root: conformanceDirectory,
      resolve: {
        alias: [
          { find: /^bippy$/, replacement: resolve(bippyDirectory, "src/index.ts") },
          { find: "bippy/source", replacement: resolve(bippyDirectory, "src/source/index.ts") },
        ],
      },
      test: {
        name: "conformance",
        include: ["tests/*.test.{ts,tsx}"],
        environment: "happy-dom",
        setupFiles: ["./tests/setup.ts"],
        testTimeout: 10000,
      },
    }),
    resolve(conformanceDirectory, "fixtures/react-devtools-headless/vite.config.ts"),
  ],
  coverage: {
    allowExternal: true,
    reportsDirectory: resolve(conformanceDirectory, "coverage"),
    include: [
      resolve(bippyDirectory, "src/**/*.ts"),
      resolve(bippyDirectory, "scripts/react-internals-plugin.ts"),
    ],
    exclude: [resolve(bippyDirectory, "src/react-internals/types.ts")],
    provider: "istanbul",
    reporter: ["text", "json", "json-summary", "html"],
  },
};

export default defineConfig({
  root: resolve(conformanceDirectory, "../.."),
  test: conformanceTestConfig,
});

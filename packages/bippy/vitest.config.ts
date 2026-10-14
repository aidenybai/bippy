import { resolve } from "node:path";
import { defineConfig, defineProject } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      defineProject({
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          environment: "happy-dom",
        },
      }),
      defineProject({
        resolve: {
          alias: [
            { find: /^bippy$/, replacement: resolve(import.meta.dirname, "src/index.ts") },
            {
              find: "bippy/source",
              replacement: resolve(import.meta.dirname, "src/source/index.ts"),
            },
          ],
        },
        test: {
          name: "conformance",
          include: ["tests/conformance/*.test.{ts,tsx}"],
          environment: "happy-dom",
          setupFiles: ["./tests/conformance/setup.ts"],
          testTimeout: 10000,
        },
      }),
      "tests/fixtures/react-devtools-headless/vitest.config.ts",
    ],
    coverage: {
      include: ["src/**/*.ts", "scripts/react-internals-generator.ts"],
      exclude: ["src/react-internals/types.ts"],
      provider: "istanbul",
      reporter: ["text", "json", "json-summary", "html"],
    },
  },
});

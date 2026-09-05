import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "bippy/source",
        replacement: resolve(import.meta.dirname, "../../../bippy/src/source/index.ts"),
      },
      {
        find: "bippy",
        replacement: resolve(import.meta.dirname, "../../../bippy/src/index.ts"),
      },
    ],
  },
  test: {
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 97,
        lines: 97,
        statements: 95,
      },
    },
    environment: "happy-dom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});

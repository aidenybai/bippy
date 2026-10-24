import { defineConfig, defineProject } from "vite-plus";

export default defineConfig({
  test: {
    projects: [
      defineProject({
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          testTimeout: 30_000,
        },
      }),
    ],
  },
});

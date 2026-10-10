import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    name: "bippy-analyzer",
    include: ["tests/**/*.test.ts"],
  },
});

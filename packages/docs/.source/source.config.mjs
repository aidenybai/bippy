// source.config.ts
import { defineConfig } from "fumadocs-mdx/config";
var source_config_default = defineConfig({
  rootDir: "content",
  baseUrl: "/docs",
  ignorePatterns: ["**/node_modules/**", "**/README.md"]
});
export {
  source_config_default as default
};

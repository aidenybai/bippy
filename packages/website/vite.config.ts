import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";

const llmsTxtPlugin = (): Plugin => {
  const readmePath = resolve(__dirname, "../bippy/README.md");
  return {
    name: "llms-txt",
    configureServer(server) {
      server.middlewares.use("/llms.txt", (_req, res) => {
        const content = readFileSync(readmePath, "utf-8");
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.end(content);
      });
    },
    closeBundle() {
      const distDir = resolve(__dirname, "dist");
      mkdirSync(distDir, { recursive: true });
      const content = readFileSync(readmePath, "utf-8");
      writeFileSync(join(distDir, "llms.txt"), content, "utf-8");
    },
  };
};

export default defineConfig({
  plugins: [react(), tailwindcss(), llmsTxtPlugin()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});

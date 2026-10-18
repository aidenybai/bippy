import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import stylex from "@stylexswc/unplugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { analysisPlugin } from "./server/analysis-plugin";

const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(packageDirectory, "../..");

export default defineConfig({
  resolve: {
    alias: { "@": resolve(packageDirectory, "src") },
  },
  plugins: [
    react(),
    tailwindcss(),
    stylex({
      rsOptions: {
        unstable_moduleResolution: { type: "commonJS", rootDir: repositoryRoot },
        include: [/^src\//, /analyzer-viz\/src\//, /diagram\/src\//, /tailwind-stylex\//],
      },
    }),
    analysisPlugin(),
  ],
  optimizeDeps: {
    exclude: ["tailwind-stylex", "diagram"],
  },
  server: {
    host: true,
    allowedHosts: [".ts.net"],
    fs: { allow: [repositoryRoot] },
  },
});

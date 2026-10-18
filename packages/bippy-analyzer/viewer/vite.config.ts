import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { viewerPlugin } from "./server/plugin";

const viewerDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(viewerDirectory, "../../..");

export default defineConfig({
  root: viewerDirectory,
  resolve: {
    alias: { "@": resolve(viewerDirectory, "src") },
  },
  plugins: [react(), tailwindcss(), viewerPlugin()],
  server: {
    host: true,
    allowedHosts: [".ts.net"],
    fs: { allow: [repositoryRoot] },
  },
});

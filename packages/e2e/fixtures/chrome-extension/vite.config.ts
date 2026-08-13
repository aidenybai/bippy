import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    sourcemap: true,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  plugins: [react()],
});

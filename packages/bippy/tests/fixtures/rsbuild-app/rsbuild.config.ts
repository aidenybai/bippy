import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

// Rspack + @rsbuild/plugin-react: the webpack-family Fast Refresh
// pipeline (react-refresh-webpack-plugin lineage), distinct from Vite's.
export default defineConfig({
  plugins: [pluginReact()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});

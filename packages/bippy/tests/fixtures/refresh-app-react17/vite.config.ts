import { resolve } from "node:path";
import { defineConfig } from "vite";

// Serves the shared refresh-app harness and scenario source against
// React 17. react-dom/client does not exist in 17, so it maps to a local
// shim over the legacy ReactDOM.render API; longest prefixes come first.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "react-dom/client",
        replacement: resolve(import.meta.dirname, "src/react-dom-17-client-shim.ts"),
      },
      { find: "react-dom", replacement: "react-dom-17" },
      { find: "react", replacement: "react-17" },
    ],
  },
});

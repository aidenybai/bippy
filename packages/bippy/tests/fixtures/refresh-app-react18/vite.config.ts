import { defineConfig } from "vite";

// Serves the shared refresh-app harness and scenario source against
// React 18. Aliases rewrite every react import (including the ones inside
// react-dom) to the 18.x packages; longest prefixes must come first.
export default defineConfig({
  resolve: {
    alias: [
      { find: "react-dom/client", replacement: "react-dom-18/client" },
      { find: "react-dom", replacement: "react-dom-18" },
      { find: "react", replacement: "react-18" },
    ],
  },
});

import { resolve } from "node:path";
import { defineConfig } from "vite";

// Serves the shared refresh-app harness and scenario source against the
// React experimental channel (nightly builds from facebook/react main).
// This is where internals changes land first, so this fixture is bippy's
// early-warning system; longest alias prefixes must come first.
// react-refresh must point at this fixture's nightly copy explicitly: the
// shared harness file lives in refresh-app, whose own node_modules holds
// the published 0.18.0 and would win plain node resolution.
export default defineConfig({
  resolve: {
    alias: [
      { find: "react-dom/client", replacement: "react-dom-experimental/client" },
      { find: "react-dom", replacement: "react-dom-experimental" },
      {
        find: "react-refresh",
        replacement: resolve(import.meta.dirname, "node_modules/react-refresh"),
      },
      { find: "react", replacement: "react-experimental" },
    ],
  },
});

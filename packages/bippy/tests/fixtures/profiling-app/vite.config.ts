import { defineConfig } from "vite";

// The React profiling build: production-grade code with profiling timers
// (actualDuration/actualStartTime on fibers), which apps opt into via the
// react-dom/profiling alias.
export default defineConfig({
  resolve: {
    alias: {
      "react-dom/client": "react-dom/profiling",
    },
  },
});

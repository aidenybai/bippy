import { resolve } from "node:path";
import { defineConfig } from "vite";

// No @vitejs/plugin-react on purpose: the harness owns the only
// react-refresh runtime on the page, mirroring facebook/react's
// ReactFresh-test.js environment while still using a real browser,
// real react-dom, and real react-refresh.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        late: resolve(import.meta.dirname, "late.html"),
      },
    },
  },
});

import { defineConfig } from "vite";

// `vite preview` serves the outDir as-is; the pages are plain static html
// with classic script tags and no bundling at all.
export default defineConfig({
  build: {
    outDir: "public",
  },
});

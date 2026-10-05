import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  envPrefix: ["VITE_", "PUBLIC_"],
  define: {
    "import.meta.env.DEFINED": JSON.stringify("configured"),
    "import.meta.env.OBJECT": JSON.stringify({ nested: "known", nullable: null }),
    ...(process.env.BIPPY_OPAQUE_ENV === "1"
      ? { "import.meta.env.PROD": "window.__VITE_UNKNOWN__" }
      : {}),
  },
});

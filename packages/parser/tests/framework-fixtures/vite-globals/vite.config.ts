import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  define: {
    __BIPPY_DEFINE_LABEL__: JSON.stringify("configured"),
    __BIPPY_DEFINE_COUNT__: "3",
    __BIPPY_DEFINE_FLAG__: "false",
    __BIPPY_DEFINE_NULL__: "null",
    __BIPPY_DEFINE_UNDEFINED__: "undefined",
    "__BIPPY_DEFINE_CONFIG__.nested.value": JSON.stringify("nested"),
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
});

import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  let resolvedMode = "unresolved";
  return {
    root: import.meta.dirname,
    mode: "configured",
    plugins: [
      {
        name: "native-mode",
        apply: (_config, environment) => environment.mode !== "disabled",
        configResolved: (config) => {
          resolvedMode = config.mode;
        },
        transform: (_sourceText, filePath) =>
          filePath.endsWith(".fixture")
            ? { code: `export default ${JSON.stringify(`${mode}:${resolvedMode}`)};` }
            : null,
      },
    ],
  };
});

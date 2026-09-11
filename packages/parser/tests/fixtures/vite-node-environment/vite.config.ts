import { createLogger, defineConfig } from "vite";

const moduleEnvironment = process.env.NODE_ENV ?? "unset";

export default defineConfig(() => {
  const factoryEnvironment = process.env.NODE_ENV ?? "unset";
  if (process.env.BIPPY_THROW_CONFIG === "1") throw new Error("configuration failure");
  let resolvedEnvironment = "unresolved";
  let warningCount = 0;
  return {
    root: import.meta.dirname,
    envDir: process.env.BIPPY_VITE_ENV_DIRECTORY,
    customLogger: {
      ...createLogger("silent"),
      warn: () => {
        warningCount += 1;
      },
    },
    plugins: [
      {
        name: "node-environment",
        configResolved: () => {
          resolvedEnvironment = process.env.NODE_ENV ?? "unset";
        },
        transform: (_sourceText, filePath) => {
          if (!filePath.endsWith(".fixture")) return null;
          const value = filePath.endsWith("warnings.fixture")
            ? String(warningCount)
            : `${moduleEnvironment}:${factoryEnvironment}:${resolvedEnvironment}`;
          return { code: `export default ${JSON.stringify(value)};` };
        },
      },
    ],
  };
});

import { defineConfig } from "vite";

const getEnvironment = () =>
  `${process.env.BIPPY_ENVIRONMENT_CHECK ?? "unset"}:${process.env.CI ?? "unset"}`;
const configured = getEnvironment();
if (process.env.BIPPY_ENVIRONMENT_CHECK === "throw") throw new Error("configuration failure");

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    {
      name: "corpus-environment",
      transform: (_sourceText, filePath) =>
        filePath.endsWith(".fixture")
          ? { code: `export default ${JSON.stringify(`${configured}|${getEnvironment()}`)};` }
          : null,
    },
  ],
});

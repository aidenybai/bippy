import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";

const corpusDirectory = dirname(fileURLToPath(import.meta.url));
const bippySourceDirectory = resolve(corpusDirectory, "../../../bippy/src");

export const CAPTURE_SCRIPT_NAME = "capture.js";

/**
 * Bundles `capture.ts` with Bippy into a self-contained script. Bippy's
 * `react.ts` entry imports React itself, which must not end up in the page
 * twice, so the bundle maps `bippy` to the hook-only core module.
 */
export const buildCaptureScript = async (outputDirectory: string): Promise<string> => {
  const outputPath = join(outputDirectory, CAPTURE_SCRIPT_NAME);
  await build({
    configFile: false,
    logLevel: "error",
    resolve: {
      alias: [
        { find: /^bippy$/, replacement: join(bippySourceDirectory, "core.ts") },
        {
          find: "bippy/install-hook-only",
          replacement: join(bippySourceDirectory, "install-hook-only.ts"),
        },
      ],
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
      "process.env.VERSION": JSON.stringify("parser-corpus"),
    },
    build: {
      lib: {
        entry: join(corpusDirectory, "capture.ts"),
        formats: ["iife"],
        name: "BippyParserCapture",
        fileName: () => CAPTURE_SCRIPT_NAME,
      },
      outDir: outputDirectory,
      emptyOutDir: false,
      minify: false,
      sourcemap: false,
      target: "es2020",
    },
  });
  if (!existsSync(outputPath)) throw new Error(`capture bundle was not written to ${outputPath}`);
  return outputPath;
};

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import { expect } from "vitest";

export const buildScriptFixture = async (
  entry: URL,
  mode: string,
  jsxDev = mode === "development",
) => {
  const filename = fileURLToPath(entry);
  const result = await build({
    root: dirname(filename),
    configFile: false,
    envFile: false,
    logLevel: "silent",
    mode,
    esbuild: { jsxDev },
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    build: {
      write: false,
      minify: false,
      sourcemap: true,
      lib: { entry: filename, name: "fixture", formats: ["iife"] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  expect(outputs).toHaveLength(1);
  const output = outputs[0];
  if (!("output" in output)) throw new Error("Unexpected native build result");
  const chunks = output.output.filter((item) => item.type === "chunk");
  expect(chunks).toHaveLength(1);
  const chunk = chunks[0];
  expect(chunk.imports).toEqual([]);
  expect(chunk.dynamicImports).toEqual([]);
  expect(chunk.map).not.toBeNull();
  return chunk;
};

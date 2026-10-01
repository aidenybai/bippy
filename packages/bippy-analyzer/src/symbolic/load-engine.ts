import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { outputDirectory, verifyEngineBuild } from "../../engine/manifest.js";
import { SymbolicEngineError } from "./errors.js";

export interface SymbolicEngine {
  api: typeof import("../../engine/dist/declaration/index.mjs");
  originalSha256: string;
  patchedSha256: string;
}

const loadEngine = async (): Promise<SymbolicEngine> => {
  try {
    const manifest = await verifyEngineBuild();
    const api: SymbolicEngine["api"] = await import(
      pathToFileURL(join(outputDirectory, "engine.mjs")).href
    );
    return {
      api,
      originalSha256: manifest.publishedBundleSha256,
      patchedSha256: manifest.outputs["engine.mjs"],
    };
  } catch (cause) {
    throw new SymbolicEngineError(
      "Source-built engine is unavailable or invalid; run pnpm --filter bippy-analyzer build:engine",
      { cause },
    );
  }
};

let pendingEngine: Promise<SymbolicEngine> | undefined;
export const getSymbolicEngine = (): Promise<SymbolicEngine> => (pendingEngine ??= loadEngine());

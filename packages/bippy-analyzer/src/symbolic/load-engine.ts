import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { SymbolicEngineCleanupError, SymbolicEngineError } from "./errors.js";

export interface SymbolicEngine {
  api: typeof import("@engine262/engine262");
  originalSha256: string;
  patchedSha256: string;
}

export const ORIGINAL_ENGINE_SHA256 =
  "bbc66b6f71a0f36e23c5ea07bbf3cc2c390de9c6c7bb1f4a0ecf5791b2b2600b";

const require = createRequire(import.meta.url);
const getHash = (source: string): string => createHash("sha256").update(source).digest("hex");

export const getPatchedEngineSource = (source: string): string => {
  if (getHash(source) !== ORIGINAL_ENGINE_SHA256) {
    throw new SymbolicEngineError(
      "Installed engine bytes differ from the reviewed symbolic engine baseline",
    );
  }
  const start = source.indexOf("function* Evaluate(node) {");
  const insertion = source.indexOf("  switch (node.type) {", start);
  if (start === -1 || insertion === -1)
    throw new SymbolicEngineError("Engine evaluator patch anchor is missing");
  const hook = [
    "  const override = surroundingAgent.hostDefinedOptions.evaluateNode?.(node, surroundingAgent.currentRealmRecord);",
    "  if (override !== undefined) return yield* override;",
    "",
  ].join("\n");
  // HACK: Upstream has no evaluation override. Extend an integrity-checked copy without modifying the installed engine or retaining its now-invalid source map.
  return `${source.slice(0, insertion)}${hook}${source.slice(insertion)}`.replace(
    "//# sourceMappingURL=engine262.mjs.map",
    "",
  );
};

const loadEngine = async (): Promise<SymbolicEngine> => {
  const original = await readFile(
    join(dirname(require.resolve("@engine262/engine262")), "engine262.mjs"),
    "utf8",
  );
  const patched = getPatchedEngineSource(original);
  const directory = await mkdtemp(join(tmpdir(), "bippy-symbolic-engine-"));
  let api: SymbolicEngine["api"];
  try {
    const filename = join(directory, "engine.mjs");
    await writeFile(filename, patched, { flag: "wx" });
    api = await import(pathToFileURL(filename).href);
  } catch (error) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new SymbolicEngineCleanupError(error, cleanupError);
    }
    throw error;
  }
  await rm(directory, { recursive: true, force: true });
  return { api, originalSha256: ORIGINAL_ENGINE_SHA256, patchedSha256: getHash(patched) };
};

let pendingEngine: Promise<SymbolicEngine> | undefined;
export const getSymbolicEngine = (): Promise<SymbolicEngine> => (pendingEngine ??= loadEngine());

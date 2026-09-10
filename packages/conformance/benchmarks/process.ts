import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { conformanceDirectory } from "../scripts/test-inventory.js";

export const runBenchmarkProcess = (
  entry: URL,
  arguments_: string[],
  reactBuild: string,
  isNative = false,
): string => {
  const result = spawnSync(
    process.execPath,
    [...(isNative ? [] : ["--import", "tsx"]), fileURLToPath(entry), ...arguments_],
    {
      cwd: conformanceDirectory,
      env: {
        ...process.env,
        NODE_ENV: reactBuild,
        TSX_TSCONFIG_PATH: fileURLToPath(new URL("../tsconfig-built.json", import.meta.url)),
      },
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  assert.equal(
    result.status,
    0,
    `${entry.href}\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
};

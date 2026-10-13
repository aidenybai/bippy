import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { packageDirectory } from "../scripts/test-inventory";

export const runBenchmarkProcess = (
  entry: URL,
  arguments_: string[],
  reactBuild: string,
): string => {
  const result = Bun.spawnSync(
    [
      "bun",
      "--tsconfig-override",
      fileURLToPath(new URL("../tsconfig-built.json", import.meta.url)),
      fileURLToPath(entry),
      ...arguments_,
    ],
    {
      cwd: packageDirectory,
      env: { ...process.env, NODE_ENV: reactBuild },
      timeout: 180000,
    },
  );
  assert.ok(result.success, `${entry.href}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.toString();
};

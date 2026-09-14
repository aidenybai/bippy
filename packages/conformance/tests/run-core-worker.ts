import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vite-plus/test";

const testsDirectory = dirname(fileURLToPath(import.meta.url));

export const runCoreWorker = (worker: string, argumentsList: string[]): string => {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", resolve(testsDirectory, worker), ...argumentsList],
    {
      cwd: resolve(testsDirectory, ".."),
      encoding: "utf8",
      timeout: 30000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
};

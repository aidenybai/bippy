import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const worker = resolve(testsDirectory, "fiber-id-boundary-worker.ts");
const directory = resolve(testsDirectory, "..");

const runBoundary = (boundary: string): string => {
  const result = spawnSync("pnpm", ["exec", "tsx", worker, boundary], {
    cwd: directory,
    encoding: "utf8",
    timeout: 30000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  const isExhausted = boundary === "near" || boundary === "at";
  const exhaustion = { error: "RangeError:Fiber ID space exhausted" };
  expect(JSON.parse(result.stdout)).toEqual({
    attempts: isExhausted
      ? [
          boundary === "near" ? { identifier: Number.MAX_SAFE_INTEGER } : exhaustion,
          exhaustion,
          exhaustion,
        ]
      : [{ identifier: 1 }, { identifier: 2 }, { identifier: 3 }],
    witnessIdentifier: isExhausted ? 0 : 3,
    originalWitnessReleased: !isExhausted,
    witnessLookup: true,
    explicitIdentifierMatches: true,
    explicitLookup: true,
    inheritedIdentifierMatches: true,
    inheritedLookup: true,
    allocationLookups: isExhausted ? [boundary === "near" ? true : null, null] : [true, true],
  });
  return result.stdout;
};

it.each(["near", "at", "beyond", "infinity", "nan", "negative"])(
  "isolates automatic allocation at explicit numeric boundary %s without overwriting live IDs",
  (boundary) => {
    expect(runBoundary(boundary)).toBe(runBoundary(boundary));
  },
);

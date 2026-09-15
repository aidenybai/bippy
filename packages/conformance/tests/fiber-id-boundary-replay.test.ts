import { expect, it } from "vite-plus/test";
import { runCoreWorker } from "./run-core-worker.js";

const runBoundary = (boundary: string): string => {
  const output = runCoreWorker("fiber-id-boundary-worker.ts", [boundary]);
  const isExhausted = boundary === "near" || boundary === "at";
  const exhaustion = { error: "RangeError:Fiber ID space exhausted" };
  expect(JSON.parse(output)).toEqual({
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
  return output;
};

it.each(["near", "at", "beyond", "infinity", "nan", "negative"])(
  "isolates automatic allocation at explicit numeric boundary %s without overwriting live IDs",
  (boundary) => {
    expect(runBoundary(boundary)).toBe(runBoundary(boundary));
  },
);

import { expect, it } from "vite-plus/test";
import { runCoreWorker } from "./run-core-worker.js";

const runChurn = (mode: string, deletedIndex: number): string => {
  const output = runCoreWorker("fiber-finalization-worker.ts", [
    "churn",
    mode,
    String(deletedIndex),
  ]);
  const count = mode === "weak" || mode === "strong" || mode === "native" ? 1 : 0;
  let nextIdentifier = 2;
  const transcript = Array.from({ length: 64 }, (_, step) => {
    const identifier = step % 4 === 0 ? nextIdentifier : (Math.floor(step / 2) % 5) + 2;
    nextIdentifier = Math.max(nextIdentifier, identifier + 1);
    return [identifier, count, 0, count];
  });
  expect(JSON.parse(output)).toEqual({
    transcript,
    nativeChecked: mode === "native",
    peakRegistrations: count,
    observations: [{ live: [true, true], registrations: [count, count, count] }],
    reports: 1,
    afterUnmount: [0, 0, count],
    afterCleanup: [0, 0, 0],
  });
  return output;
};

it.each(
  ["weak", "weak-only", "strong", "neither", "native"].flatMap((mode) =>
    [0, 1].map((deletedIndex) => ({ mode, deletedIndex })),
  ),
)(
  "bounds finalization metadata across retained-fiber churn, mode $mode, delete $deletedIndex",
  ({ mode, deletedIndex }) => {
    expect(runChurn(mode, deletedIndex)).toBe(runChurn(mode, deletedIndex));
  },
);

const runCollection = (mode: string, direction: string, lookupOrder: string): string => {
  const output = runCoreWorker("fiber-finalization-worker.ts", [
    "collection",
    mode,
    direction,
    lookupOrder,
  ]);
  const hasFinalizer = mode === "weak";
  const isLookupFirst = lookupOrder === "first";
  expect(JSON.parse(output)).toEqual({
    transcript: [
      ...(isLookupFirst ? [["owner-0", "owner-1", "control"]] : []),
      ["owner-0", "owner-1", "control"],
      ["replacement", "owner-1", "control"],
      ["replacement", null, "control"],
      [null, null, null],
    ],
    queuedCounts: hasFinalizer ? [2, 1, 1] : [0, 0, 0],
    lookupReads: [isLookupFirst ? 1 : 0, !isLookupFirst && !hasFinalizer ? 1 : 0, 0],
    beforeCleanup: hasFinalizer ? [1, 1] : [0, 0],
    afterCleanup: [0, 0, 0, 0, 0, 0],
  });
  return output;
};

it.each(
  ["weak", "weak-only"].flatMap((mode) =>
    ["forward", "reverse"].flatMap((direction) =>
      ["first", "last"].map((lookupOrder) => ({ mode, direction, lookupOrder })),
    ),
  ),
)(
  "preserves new owners through scheduled weak collection, mode $mode, callbacks $direction, lookup $lookupOrder",
  ({ mode, direction, lookupOrder }) => {
    expect(runCollection(mode, direction, lookupOrder)).toBe(
      runCollection(mode, direction, lookupOrder),
    );
  },
);

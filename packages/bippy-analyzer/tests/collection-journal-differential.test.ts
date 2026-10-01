import { describe, expect, it } from "vite-plus/test";
import { StaticCollection } from "../src/evaluate/collections.js";
import { objectFromRecord, primitiveValue } from "../src/evaluate/values.js";
import type { StaticValue } from "../src/types.js";
import { createSeededRandom, differentialSeeds } from "./helpers/differential-evaluator.js";

interface JournalCheckpoint {
  analyzer: ReturnType<StaticCollection["capture"]>;
  native: Map<unknown, StaticValue>;
}

interface JournalKey {
  analyzer: StaticValue;
  native: unknown;
}

interface CollectionKind {
  kind: ConstructorParameters<typeof StaticCollection>[0];
}

const kinds: CollectionKind[] = [
  { kind: "Map" },
  { kind: "Set" },
  { kind: "WeakMap" },
  { kind: "WeakSet" },
];

const getNativeKey = (value: StaticValue): unknown =>
  value.kind === "primitive" ? value.value : value;

const checkCheckpoint = (checkpoint: JournalCheckpoint, context: string): void => {
  const actual = [...checkpoint.analyzer.entries.values()];
  const expected = [...checkpoint.native];
  expect(
    actual.map((entry) => getNativeKey(entry.key)),
    context,
  ).toEqual(expected.map(([key]) => key));
  expect(
    actual.map((entry) => entry.value),
    context,
  ).toEqual(expected.map(([, value]) => value));
  expect(
    actual.map((entry) => entry.presence),
    context,
  ).toEqual(expected.map(() => primitiveValue(true)));
  for (let index = 0; index < expected.length; index++) {
    expect(Object.is(getNativeKey(actual[index].key), expected[index][0]), context).toBe(true);
    expect(actual[index].value === expected[index][1], context).toBe(true);
  }
};

describe.each(kinds)("$kind copy-on-write journal", ({ kind }) => {
  it.each(differentialSeeds)(
    "preserves retained snapshots across adversarial restores and writes, seed %i",
    (seed) => {
      const getRandom = createSeededRandom(seed);
      const objects = Array.from({ length: 5 }, () => objectFromRecord({}));
      const keys: JournalKey[] = objects.map((object) => ({ analyzer: object, native: object }));
      if (!kind.startsWith("Weak")) {
        for (const value of [0, NaN, undefined, null, "__proto__", "constructor", ""]) {
          keys.push({ analyzer: primitiveValue(value), native: value });
        }
      }
      const collection = new StaticCollection(kind, 0, null);
      let native = new Map<unknown, StaticValue>();
      const checkpoints: JournalCheckpoint[] = [
        { analyzer: collection.capture(), native: new Map(native) },
      ];
      const exercised = new Set<string>();
      const operations = ["write", "delete", "checkpoint", "restore", "clear", "join-identical"];
      for (let step = 0; step < 500; step++) {
        const operation =
          operations[step < operations.length ? step : getRandom(operations.length)];
        const key = keys[getRandom(keys.length)];
        const context = JSON.stringify({ kind, seed, step, operation });
        exercised.add(operation);
        switch (operation) {
          case "write": {
            const value = kind.endsWith("Set") ? key.analyzer : primitiveValue(getRandom(20));
            collection.set(key.analyzer, value);
            native.set(key.native, value);
            break;
          }
          case "delete":
            expect(collection.delete(key.analyzer), context).toEqual(
              primitiveValue(native.delete(key.native)),
            );
            break;
          case "checkpoint":
            checkpoints.push({ analyzer: collection.capture(), native: new Map(native) });
            break;
          case "restore": {
            const selected = checkpoints[getRandom(checkpoints.length)];
            collection.restore(selected.analyzer);
            native = new Map(selected.native);
            break;
          }
          case "clear":
            collection.clear();
            native.clear();
            break;
          case "join-identical": {
            const selected = checkpoints[getRandom(checkpoints.length)];
            collection.join([selected.analyzer, selected.analyzer], "same checkpoint", null, 0);
            native = new Map(selected.native);
            break;
          }
        }
        for (const queried of keys) {
          expect(collection.has(queried.analyzer), context).toEqual(
            primitiveValue(native.has(queried.native)),
          );
          expect(collection.get(queried.analyzer), context).toEqual(
            native.get(queried.native) ?? primitiveValue(undefined),
          );
        }
        if (step % 7 === 0) checkCheckpoint({ analyzer: collection.capture(), native }, context);
        checkCheckpoint(checkpoints[getRandom(checkpoints.length)], context);
      }
      for (const checkpoint of checkpoints)
        checkCheckpoint(checkpoint, `${kind}/seed=${seed}/retained checkpoint`);
      expect([...exercised].sort()).toEqual([...operations].sort());
    },
  );
});

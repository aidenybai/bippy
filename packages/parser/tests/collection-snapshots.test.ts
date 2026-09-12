import { describe, expect, it } from "vitest";
import { StaticCollection } from "../src/evaluate/collections.js";
import { createPathPredicate } from "../src/evaluate/predicates.js";
import {
  FALSE_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  getTruthiness,
  objectFromRecord,
  unknownValue,
} from "../src/evaluate/values.js";

interface CollectionCase {
  kind: ConstructorParameters<typeof StaticCollection>[0];
}

const collectionCases: CollectionCase[] = [
  { kind: "Map" },
  { kind: "Set" },
  { kind: "WeakMap" },
  { kind: "WeakSet" },
];

const getSeededCollection = (kind: CollectionCase["kind"]) => {
  const collection = new StaticCollection(kind, 0, null);
  const key = objectFromRecord({});
  collection.set(key, key);
  return { collection, key };
};

describe.each(collectionCases)("$kind journal snapshots", ({ kind }) => {
  it("shares entry tables until a write", () => {
    const { collection, key } = getSeededCollection(kind);
    const before = collection.capture();
    expect(collection.capture().entries).toBe(before.entries);
    const nextKey = objectFromRecord({});
    collection.set(nextKey, nextKey);
    const after = collection.capture();
    expect(after.entries).not.toBe(before.entries);
    expect(before.entries.size).toBe(1);
    expect(before.entries.has(nextKey)).toBe(false);
    expect(collection.get(key)).toBe(key);
    expect(collection.get(nextKey)).toBe(nextKey);
    expect(collection.capture().entries).toBe(after.entries);
  });

  it("restores shared tables without mutating retained branches", () => {
    const { collection, key } = getSeededCollection(kind);
    const original = collection.capture();
    const nextKey = objectFromRecord({});
    collection.set(nextKey, nextKey);
    const changed = collection.capture();
    collection.restore(original);
    expect(collection.capture().entries).toBe(original.entries);
    expect(collection.get(nextKey)).toBe(UNDEFINED_VALUE);
    expect(collection.delete(key)).toBe(TRUE_VALUE);
    expect(original.entries.has(key)).toBe(true);
    expect(changed.entries.has(key)).toBe(true);
    expect(changed.entries.has(nextKey)).toBe(true);
    expect(collection.capture().entries.size).toBe(0);
    collection.restore(changed);
    expect(collection.get(nextKey)).toBe(nextKey);
    expect(collection.capture().writeCount).toBe(2);
  });

  it("discards uncaptured writable tables when restoring", () => {
    const { collection, key } = getSeededCollection(kind);
    const original = collection.capture();
    const temporaryKey = objectFromRecord({});
    collection.set(temporaryKey, temporaryKey);
    collection.restore(original);
    const nextKey = objectFromRecord({});
    collection.set(nextKey, nextKey);
    expect([...collection.capture().entries.keys()]).toEqual([key, nextKey]);
    expect([...original.entries.keys()]).toEqual([key]);
    expect(collection.get(temporaryKey)).toBe(UNDEFINED_VALUE);
  });

  it("replaces uncaptured writable tables when joining shared snapshots", () => {
    const { collection, key } = getSeededCollection(kind);
    const original = collection.capture();
    const temporaryKey = objectFromRecord({});
    collection.set(temporaryKey, temporaryKey);
    collection.join([original, original], "shared paths", null, 0);
    const nextKey = objectFromRecord({});
    collection.set(nextKey, nextKey);
    expect([...collection.capture().entries.keys()]).toEqual([key, nextKey]);
    expect([...original.entries.keys()]).toEqual([key]);
    expect(collection.get(temporaryKey)).toBe(UNDEFINED_VALUE);
  });

  it("joins unchanged entry tables without copying them", () => {
    const { collection, key } = getSeededCollection(kind);
    const first = collection.capture();
    const second = collection.capture();
    collection.join([first, second], "unchanged paths", null, 0);
    const joined = collection.capture();
    expect(joined.entries).toBe(first.entries);
    expect(joined.writeCount).toBe(1);
    collection.delete(key);
    expect(first.entries.has(key)).toBe(true);
    expect(second.entries.has(key)).toBe(true);
    expect(joined.entries.has(key)).toBe(true);
  });

  it("joins outside-mutation flags even when entry tables are shared", () => {
    const { collection, key } = getSeededCollection(kind);
    const original = collection.capture();
    collection.markExternallyMutable();
    const escaped = collection.capture();
    collection.restore(original);
    collection.join([original, escaped], "escape paths", null, 0);
    const joined = collection.capture();
    expect(joined.isExternallyMutable).toBe(true);
    expect(original.isExternallyMutable).toBe(false);
    expect(joined.entries).toBe(original.entries);
    expect(getTruthiness(collection.has(key))).toBe(null);
    collection.restore(original);
    expect(collection.has(key)).toBe(TRUE_VALUE);
  });

  it("preserves snapshots through clear and reinsertion", () => {
    const { collection, key } = getSeededCollection(kind);
    const original = collection.capture();
    collection.clear();
    const nextKey = objectFromRecord({});
    collection.set(nextKey, nextKey);
    const cleared = collection.capture();
    expect([...original.entries.keys()]).toEqual([key]);
    expect([...cleared.entries.keys()]).toEqual([nextKey]);
    collection.restore(original);
    collection.set(nextKey, nextKey);
    expect([...collection.capture().entries.keys()]).toEqual([key, nextKey]);
    expect([...cleared.entries.keys()]).toEqual([nextKey]);
  });

  it("preserves guards and insertion order when joined tables differ", () => {
    const { collection, key } = getSeededCollection(kind);
    const original = collection.capture();
    const leftKey = objectFromRecord({});
    collection.set(leftKey, leftKey);
    const left = collection.capture();
    collection.restore(original);
    const rightKey = objectFromRecord({});
    collection.set(rightKey, rightKey);
    const right = collection.capture();
    const temporaryKey = objectFromRecord({});
    collection.set(temporaryKey, temporaryKey);
    collection.join([left, right], "changed paths", null, 0, createPathPredicate("choice", null));
    const nextKey = objectFromRecord({});
    collection.set(nextKey, nextKey);
    const joined = collection.capture();
    expect([...joined.entries.keys()]).toEqual([key, leftKey, rightKey, nextKey]);
    expect(joined.entries.get(key)?.presence).toBe(TRUE_VALUE);
    expect(getTruthiness(joined.entries.get(leftKey)?.presence ?? FALSE_VALUE)).toBe(null);
    expect(getTruthiness(joined.entries.get(rightKey)?.presence ?? FALSE_VALUE)).toBe(null);
    expect(left.entries.has(rightKey)).toBe(false);
    expect(right.entries.has(leftKey)).toBe(false);
    collection.clear();
    expect(joined.entries.size).toBe(4);
  });

  it("keeps prior presence values after a dynamic deletion", () => {
    const { collection, key } = getSeededCollection(kind);
    const original = collection.capture();
    collection.delete(unknownValue("unknown collection key", null));
    const changed = collection.capture();
    expect(original.entries.get(key)?.presence).toBe(TRUE_VALUE);
    expect(getTruthiness(changed.entries.get(key)?.presence ?? FALSE_VALUE)).toBe(null);
    collection.restore(original);
    expect(collection.has(key)).toBe(TRUE_VALUE);
    expect(getTruthiness(changed.entries.get(key)?.presence ?? FALSE_VALUE)).toBe(null);
  });
});

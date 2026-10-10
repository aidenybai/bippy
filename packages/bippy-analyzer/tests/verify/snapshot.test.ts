import { describe, expect, it } from "vite-plus/test";
import { forEachPlainObject, snapshotValue } from "./snapshot.js";

describe("snapshotValue", () => {
  it("changes when an array is mutated in place", () => {
    const tags = ["a"];
    const before = snapshotValue(tags);
    tags.push("b");
    expect(snapshotValue(tags)).not.toBe(before);
  });

  it("changes when a nested field, map or set is mutated", () => {
    const state = {
      stats: { clicks: 0 },
      seen: new Set<string>(),
      byId: new Map<number, string>(),
    };
    const before = snapshotValue(state);
    state.stats.clicks += 1;
    const afterClick = snapshotValue(state);
    state.seen.add("a");
    const afterAdd = snapshotValue(state);
    state.byId.set(1, "a");
    expect(new Set([before, afterClick, afterAdd, snapshotValue(state)]).size).toBe(4);
  });

  it("is stable across cycles, functions and class instances", () => {
    class Store {
      count = 0;
    }
    const store = new Store();
    const node: Record<string, unknown> = { onClick: () => undefined, store };
    node.self = node;
    const before = snapshotValue(node);
    store.count += 1;
    expect(snapshotValue(node)).toBe(before);
    expect(before).toContain("[cycle]");
    expect(before).toContain("[function]");
    expect(before).toContain("[instance]");
  });

  it("tells undefined apart from a missing field", () => {
    expect(snapshotValue({ value: undefined })).not.toBe(snapshotValue({}));
  });
});

describe("forEachPlainObject", () => {
  it("visits nested plain objects once and skips class instances", () => {
    const shared = { id: 1 };
    const visited: object[] = [];
    forEachPlainObject(
      { list: [shared, shared], date: new Date(0), error: new Error("x") },
      (object) => visited.push(object),
    );
    expect(visited.filter((object) => object === shared)).toHaveLength(1);
    expect(visited.some((object) => object instanceof Error)).toBe(false);
    expect(visited).toHaveLength(4);
  });
});

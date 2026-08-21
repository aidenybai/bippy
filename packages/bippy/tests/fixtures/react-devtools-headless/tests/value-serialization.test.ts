import { describe, expect, it } from "vite-plus/test";
import { normalizeProps, normalizeValue } from "../src/value-serialization.js";

describe("upstream value serialization behavior", () => {
  it("serializes maps as typed collections instead of empty objects", () => {
    expect(normalizeValue(new Map([["a", 1]]))).toEqual({
      entries: [["a", 1]],
      size: 1,
      type: "Map",
    });
    expect(normalizeProps({ lookup: new Map([["a", { nested: true }]]) })).toEqual({
      lookup: { entries: [["a", { nested: true }]], size: 1, type: "Map" },
    });
  });

  it("serializes sets as typed collections instead of empty objects", () => {
    expect(normalizeValue(new Set(["a", "b"]))).toEqual({
      entries: ["a", "b"],
      size: 2,
      type: "Set",
    });
  });

  it("serializes dates as typed markers instead of empty objects", () => {
    expect(normalizeValue(new Date("2024-01-02T03:04:05.000Z"))).toBe(
      "[Date 2024-01-02T03:04:05.000Z]",
    );
    expect(normalizeValue(new Date("not a date"))).toBe("[Date Invalid Date]");
  });

  it("keeps collection entries within the depth and cycle limits", () => {
    const cyclicSet = new Set<unknown>();
    cyclicSet.add(cyclicSet);
    expect(normalizeValue(cyclicSet)).toEqual({
      entries: ["[circular]"],
      size: 1,
      type: "Set",
    });
    expect(normalizeValue({ a: { b: { c: new Map([["d", 1]]) } } })).toEqual({
      a: { b: { c: "[max depth]" } },
    });
  });

  it("replaces throwing property getters with an exception marker", () => {
    const props = {
      get boom() {
        throw new Error("getter exploded");
      },
      safe: "value",
    };
    expect(normalizeProps(props)).toEqual({
      boom: "[Exception: getter exploded]",
      safe: "value",
    });
    expect(
      normalizeValue({
        nested: {
          get boom() {
            throw "string failure";
          },
        },
      }),
    ).toEqual({ nested: { boom: "[Exception: string failure]" } });
  });
});

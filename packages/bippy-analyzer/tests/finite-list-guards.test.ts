import { describe, expect, it } from "vite-plus/test";
import { hasNamedProperty } from "../src/evaluate/has-property.js";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import { createPathPredicate } from "../src/evaluate/predicates.js";
import {
  branchValue,
  FALSE_VALUE,
  getListLength,
  listValue,
  optionalValue,
  primitiveValue,
  setListLength,
  spreadListItems,
  TRUE_VALUE,
} from "../src/evaluate/values.js";

describe("finite list guards", () => {
  it.each([8, 9])(
    "keeps the existing sum distribution limit for %s independent positions",
    (count) => {
      const values = listValue(
        Array.from({ length: count }, (_value, index) =>
          optionalValue(
            primitiveValue(index),
            "position",
            null,
            false,
            createPathPredicate(`position ${index}`, null),
          ),
        ),
      );
      const length = getListLength(values);
      if (count === 8) {
        expect(length).toMatchObject({ kind: "branch" });
        if (length.kind !== "branch") throw new Error("Expected guarded lengths");
        expect(length.alternatives).toEqual(
          Array.from({ length: 9 }, (_value, index) => primitiveValue(8 - index)),
        );
      } else {
        expect(length).toMatchObject({
          kind: "unknown-primitive",
          primitiveType: "number",
          numberRange: { min: 0, max: 9 },
        });
        expect(hasNamedProperty("0", values)).toBeNull();
      }
    },
  );

  it("keeps a definite prefix when calculating guarded lengths and index presence", () => {
    const predicate = createPathPredicate("suffix exists", null);
    const values = listValue([
      primitiveValue(1),
      optionalValue(primitiveValue(2), "suffix", null, false, predicate),
      optionalValue(primitiveValue(3), "suffix", null, false, predicate),
    ]);
    expect(getListLength(values)).toMatchObject({
      kind: "branch",
      predicate,
      alternatives: [primitiveValue(3), primitiveValue(1)],
    });
    for (const index of ["1", "2"]) {
      expect(hasNamedProperty(index, values)).toMatchObject({
        kind: "branch",
        predicate,
        alternatives: [TRUE_VALUE, FALSE_VALUE],
      });
    }
    expect(hasNamedProperty("0", values)).toEqual(TRUE_VALUE);
    expect(hasNamedProperty("3", values)).toEqual(FALSE_VALUE);
  });

  it("preserves finite shrinking paths and their preferred length", () => {
    const values = listValue([1, 2, 3].map(primitiveValue));
    const journal = new HeapJournal();
    journal.record(values);
    setListLength(values, 1);
    journal.endPath();
    expect(values.items).toEqual([1, 2, 3].map(primitiveValue));
    journal.endPath();
    journal.join("shrink", null, 0, createPathPredicate("shrink", null));
    expect(values.items[0]).toEqual(primitiveValue(1));
    expect(values.items.slice(1).map((item) => item.kind)).toEqual(["optional", "optional"]);
    expect(getListLength(values)).toMatchObject({
      kind: "branch",
      preferredIndex: 1,
      alternatives: [primitiveValue(3), primitiveValue(1)],
    });
  });

  it("joins replacements by position without widening unchanged elements", () => {
    const values = listValue([1, 2, 3].map(primitiveValue));
    const journal = new HeapJournal();
    const predicate = createPathPredicate("replace", null);
    journal.record(values);
    values.items[1] = primitiveValue(9);
    journal.endPath();
    journal.endPath();
    journal.join("replace", null, 0, predicate);
    expect(values.items).toEqual([
      primitiveValue(1),
      expect.objectContaining({
        kind: "branch",
        predicate,
        alternatives: [primitiveValue(9), primitiveValue(2)],
      }),
      primitiveValue(3),
    ]);
  });

  it("keeps an empty preferred spread and an entire guarded suffix", () => {
    const source = branchValue(
      [listValue([]), listValue([1, 2].map(primitiveValue))],
      "spread",
      null,
      0,
      createPathPredicate("empty", null),
    );
    const values = listValue(spreadListItems(source, null));
    expect(values.items.map((item) => item.kind)).toEqual(["optional", "optional"]);
    expect(getListLength(values)).toMatchObject({
      kind: "branch",
      preferredIndex: 1,
      alternatives: [primitiveValue(2), primitiveValue(0)],
    });
  });

  it("does not treat an unbounded mutation loop as one finite choice", () => {
    const values = listValue([1, 2, 3].map(primitiveValue));
    const journal = new HeapJournal();
    journal.record(values);
    setListLength(values, 1);
    journal.endPath();
    journal.endPath();
    journal.join("unbounded shrink", null, 0, null, true);
    expect(values.items).toEqual([expect.objectContaining({ kind: "repeat" })]);
    expect(getListLength(values)).toMatchObject({
      kind: "unknown-primitive",
      primitiveType: "number",
    });
  });
});

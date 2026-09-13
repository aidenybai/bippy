import { describe, expect, it } from "vite-plus/test";
import {
  branchValue,
  compareDeeply,
  listValue,
  objectFromRecord,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";

const record = (entries: Record<string, string | number | boolean | null | undefined>) =>
  objectFromRecord(
    Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, primitiveValue(value)])),
  );

describe("compareDeeply (lodash isEqual over static values)", () => {
  it("decides structurally equal plain data as equal", () => {
    expect(compareDeeply(record({ page: 1, sort: "id" }), record({ sort: "id", page: 1 }))).toBe(
      true,
    );
    expect(
      compareDeeply(
        listValue([record({ id: 1 }), primitiveValue("a")]),
        listValue([record({ id: 1 }), primitiveValue("a")]),
      ),
    ).toBe(true);
    expect(compareDeeply(primitiveValue(Number.NaN), primitiveValue(Number.NaN))).toBe(true);
  });

  it("decides differing keys, lengths, values and shapes as unequal", () => {
    expect(compareDeeply(record({ page: 1 }), record({ page: 2 }))).toBe(false);
    expect(compareDeeply(record({ page: 1 }), record({ page: 1, sort: "id" }))).toBe(false);
    expect(compareDeeply(listValue([primitiveValue(1)]), listValue([]))).toBe(false);
    expect(compareDeeply(listValue([]), record({}))).toBe(false);
    expect(compareDeeply(record({}), primitiveValue(1))).toBe(false);
    expect(compareDeeply(primitiveValue(null), primitiveValue(undefined))).toBe(false);
  });

  it("stays undecided when a compared value is unknown", () => {
    expect(compareDeeply(record({ page: 1 }), unknownValue("stored"))).toBeNull();
    expect(
      compareDeeply(
        objectFromRecord({ page: unknownPrimitiveValue("number", "query") }),
        record({ page: 1 }),
      ),
    ).toBeNull();
    expect(compareDeeply(primitiveValue(1), unknownPrimitiveValue("number", "query"))).toBeNull();
  });

  it("decides across branches only when every alternative agrees", () => {
    const eitherPage = branchValue([record({ page: 1 }), record({ page: 2 })], "either");
    expect(compareDeeply(eitherPage, record({ page: 3 }))).toBe(false);
    expect(compareDeeply(eitherPage, record({ page: 1 }))).toBeNull();
    expect(compareDeeply(eitherPage, eitherPage)).toBe(true);
  });
});

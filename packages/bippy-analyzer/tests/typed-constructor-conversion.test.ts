import { expect, it } from "vite-plus/test";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { constructBinary, getBinaryKind } from "../src/evaluate/typed-arrays.js";
import {
  branchValue,
  listValue,
  optionalValue,
  primitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";

const constructors = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
};
it.each(Object.entries(constructors))(
  "converts 10000 definite %s elements without aliasing source storage",
  (name, Constructor) => {
    const input = Array.from({ length: 10000 }, (_value, index) => (index - 5000) / 7);
    const source = listValue(input.map(primitiveValue));
    const result = constructBinary(name, [source], null);
    if (result.kind !== "list") throw new Error("Expected typed list");
    expect(getBinaryKind(result)).toBe(name);
    expect(result.items).toEqual(Array.from(new Constructor(input), primitiveValue));
    expect(result.items).not.toBe(source.items);
    expect(source.items).toEqual(input.map(primitiveValue));
  },
);
it.each([4, 5])("retains the finite-shape budget for %i independent optional elements", (count) => {
  const source = listValue(
    Array.from({ length: count }, (_value, index) =>
      optionalValue(
        primitiveValue(257 + index),
        "presence",
        null,
        false,
        createPathPredicate(`presence ${index}`, null),
      ),
    ),
  );
  const result = constructBinary("Uint8Array", [source], null);
  if (count === 4) {
    if (result.kind !== "branch") throw new Error("Expected finite shapes");
    expect(result.alternatives).toHaveLength(16);
    expect(
      result.alternatives.every((alternative) => getBinaryKind(alternative) === "Uint8Array"),
    ).toBe(true);
  } else
    expect(result).toMatchObject({
      kind: "unknown",
      reason: "new Uint8Array() with unsupported element conversion",
    });
});
it("preserves element choice guards and preference through conversion", () => {
  const item = branchValue(
    [primitiveValue(257), primitiveValue(258)],
    "choice",
    null,
    1,
    createPathPredicate("choice", null),
  );
  const source = listValue([item]);
  const result = constructBinary("Uint8Array", [source], null);
  if (item.kind !== "branch" || result.kind !== "list" || result.items[0].kind !== "branch")
    throw new Error("Expected guarded element");
  const converted = result.items[0];
  expect(converted.alternatives).toEqual([primitiveValue(1), primitiveValue(2)]);
  expect(converted.preferredIndex).toBe(1);
  expect(getAlternativeGuards(converted)).toEqual(getAlternativeGuards(item));
  expect(source.items[0]).toBe(item);
});
it("does not fabricate numeric elements for an opaque source value", () => {
  const source = listValue([unknownValue("opaque element")]);
  expect(constructBinary("Uint8Array", [source], null)).toMatchObject({
    kind: "unknown",
    reason: "new Uint8Array() with unsupported element conversion",
  });
});

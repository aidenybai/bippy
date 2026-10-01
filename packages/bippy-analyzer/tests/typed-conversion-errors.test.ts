import { expect, it } from "vite-plus/test";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { getCaughtValue, getThrowCertainty } from "../src/evaluate/thrown.js";
import { convertTypedElements, getBinaryKind } from "../src/evaluate/typed-arrays.js";
import {
  branchValue,
  createSymbolValue,
  getObjectProperty,
  primitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";

it.each([16, 17])("bounds %i conversion alternatives including an error", (count) => {
  const item = branchValue(
    Array.from({ length: count }, (_value, index) => primitiveValue(index === 0 ? 1n : index)),
    "conversion",
    null,
    count - 1,
  );
  const result = convertTypedElements("Uint8Array", [item], null);
  if (count === 17)
    expect(result).toMatchObject({
      kind: "unknown",
      reason: "new Uint8Array() exceeds supported element alternatives",
    });
  else {
    if (result.kind !== "branch") throw new Error("Expected conversion choices");
    expect(result.alternatives).toHaveLength(16);
    expect(result.preferredIndex).toBe(15);
    expect(getThrowCertainty(result.alternatives[0])).toBe("always");
    expect(
      result.alternatives
        .slice(1)
        .every((alternative) => getBinaryKind(alternative) === "Uint8Array"),
    ).toBe(true);
  }
});
it.each([4, 5])("retains the raw %i by four error distribution bound", (count) => {
  const first = branchValue(
    Array.from({ length: count }, (_value, index) => primitiveValue(index === 0 ? 1n : index)),
    "first",
  );
  const second = branchValue(
    [createSymbolValue("second"), primitiveValue(1), primitiveValue(2), primitiveValue(3)],
    "second",
  );
  const result = convertTypedElements("Uint8Array", [first, second], null);
  if (count === 5)
    expect(result).toMatchObject({
      kind: "unknown",
      reason: "new Uint8Array() exceeds supported element alternatives",
    });
  else {
    if (result.kind !== "branch") throw new Error("Expected product");
    expect(result.alternatives.filter((alternative) => alternative.kind === "list")).toHaveLength(
      9,
    );
    expect(
      result.alternatives.filter((alternative) => getThrowCertainty(alternative) === "always"),
    ).toHaveLength(2);
  }
});
it("does not expand purely numeric element alternatives", () => {
  const item = branchValue(
    Array.from({ length: 17 }, (_value, index) => primitiveValue(index)),
    "numeric",
  );
  const result = convertTypedElements("Uint8Array", [item], null);
  if (result.kind !== "list" || result.items[0].kind !== "branch")
    throw new Error("Expected stored numeric alternatives");
  expect(result.items[0].alternatives).toHaveLength(17);
});
it("preserves the first failing choice guards and preference", () => {
  const first = branchValue(
    [primitiveValue(1), primitiveValue(1n)],
    "first",
    null,
    1,
    createPathPredicate("first", null),
  );
  const result = convertTypedElements("Uint8Array", [first, createSymbolValue("later")], null);
  if (first.kind !== "branch" || result.kind !== "branch")
    throw new Error("Expected guarded errors");
  expect(result.preferredIndex).toBe(1);
  expect(getAlternativeGuards(result)).toEqual(getAlternativeGuards(first));
  expect(getThrowCertainty(result)).toBe("always");
});
it("does not let an opaque conversion obscure an earlier error or invent a later error", () => {
  const opaque = unknownValue("opaque", null);
  expect(convertTypedElements("Uint8Array", [opaque, primitiveValue(1n)], null)).toEqual(
    unknownValue("new Uint8Array() with unsupported element conversion", null),
  );
  expect(
    getThrowCertainty(convertTypedElements("Uint8Array", [primitiveValue(1n), opaque], null)),
  ).toBe("always");
});
it.each([
  { name: "BigInt", native: 1n, modeled: primitiveValue(1n) },
  { name: "Symbol", native: Symbol("late"), modeled: createSymbolValue("late") },
])("handles a $name error after 9,999 definite elements", (testCase) => {
  const prefix = Array.from({ length: 9999 }, (_value, index) => index);
  expect(() => Reflect.apply(Int32Array.of, Int32Array, [...prefix, testCase.native])).toThrow(
    `Cannot convert a ${testCase.name} value to a number`,
  );
  const result = convertTypedElements(
    "Int32Array",
    [...prefix.map(primitiveValue), testCase.modeled],
    null,
    "Int32Array.of()",
  );
  expect(getThrowCertainty(result)).toBe("always");
  const error = getCaughtValue(result, null);
  if (error.kind !== "object") throw new Error("Expected modeled error");
  expect(getObjectProperty(error, "message")).toEqual(
    primitiveValue(`Cannot convert a ${testCase.name} value to a number`),
  );
  expect(getObjectProperty(error, "stack")).toMatchObject({
    kind: "unknown-primitive",
    primitiveType: "string",
  });
});

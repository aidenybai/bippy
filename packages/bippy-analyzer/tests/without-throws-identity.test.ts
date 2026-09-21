import { expect, it } from "vite-plus/test";
import { getThrowCertainty, withoutThrows } from "../src/evaluate/thrown.js";
import { binaryValue, getBinaryKind } from "../src/evaluate/typed-arrays.js";
import {
  branchValue,
  listValue,
  optionalValue,
  primitiveValue,
  thrownValue,
} from "../src/evaluate/values.js";
import { createPathPredicate } from "../src/evaluate/predicates.js";

it("preserves a nonthrowing binary list through completion refinement", () => {
  const item = branchValue(
    [primitiveValue(1), primitiveValue(2)],
    "choice",
    null,
    1,
    createPathPredicate("choice", null),
  );
  const value = binaryValue("Uint8Array", [item]);
  expect(getThrowCertainty(value)).toBe("never");
  expect(withoutThrows(value)).toBe(value);
  expect(getBinaryKind(withoutThrows(value))).toBe("Uint8Array");
});
it("preserves nonthrowing structures and aliases", () => {
  const list = listValue([primitiveValue(1)]);
  const optional = optionalValue(
    list,
    "presence",
    null,
    true,
    createPathPredicate("presence", null),
  );
  const branch = branchValue(
    [list, listValue([])],
    "choice",
    null,
    1,
    createPathPredicate("choice", null),
  );
  for (const value of [list, optional, branch]) expect(withoutThrows(value)).toBe(value);
});
it("selects the surviving branded alternative without cloning it", () => {
  const list = binaryValue("Uint8Array", [primitiveValue(1)]);
  const value = branchValue(
    [list, thrownValue("token", primitiveValue("token"), null)],
    "choice",
    null,
    0,
    createPathPredicate("choice", null),
  );
  expect(getThrowCertainty(value)).toBe("maybe");
  expect(withoutThrows(value)).toBe(list);
});

import { expect, it } from "vite-plus/test";
import { concatenateStrings, toStringValue } from "../src/evaluate/primitive-shapes.js";
import { getAlternativeGuards, getTruthinessPredicate } from "../src/evaluate/predicates.js";
import {
  branchValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";
it("keeps the Boolean input predicate on its two string representations", () => {
  const value = unknownPrimitiveValue("boolean", "input");
  const result = toStringValue(value);
  expect(result).toMatchObject({
    kind: "branch",
    predicate: getTruthinessPredicate(value),
    alternatives: [primitiveValue("true"), primitiveValue("false")],
  });
  if (result.kind !== "branch") throw new Error("Expected Boolean alternatives");
  expect(getAlternativeGuards(result)?.inputs).toHaveLength(1);
});
it("does not turn unconstrained values into Boolean text", () => {
  expect(toStringValue(unknownValue("arbitrary value")).kind).toBe("unknown-primitive");
  expect(concatenateStrings(primitiveValue("prefix:"), unknownValue("arbitrary value")).kind).toBe(
    "unknown-primitive",
  );
});
it("keeps the raw sixteen-pair text distribution limit", () => {
  const value = unknownPrimitiveValue("boolean", "input");
  const alternatives = Array.from({ length: 9 }, (_value, index) =>
    primitiveValue(`prefix:${index}:`),
  );
  const allowed = concatenateStrings(branchValue(alternatives.slice(0, 8), "prefix"), value);
  expect(allowed.kind).toBe("branch");
  if (allowed.kind === "branch") expect(allowed.alternatives).toHaveLength(16);
  expect(concatenateStrings(branchValue(alternatives, "prefix"), value).kind).toBe(
    "unknown-primitive",
  );
});

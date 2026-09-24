import { expect, it } from "vite-plus/test";
import { callArrayMethod, type ArrayMethodEvaluator } from "../src/evaluate/array-methods.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import {
  parseSymbolicPredicate,
  serializeSymbolicPredicate,
} from "../src/symbolic/serialization.js";
import { listValue, optionalValue, primitiveValue } from "../src/evaluate/values.js";
import type { StaticValue } from "../src/types.js";
import { createEvaluationContext } from "./helpers/evaluation-context.js";
const unexpected = (): never => {
  throw new Error("Unexpected evaluator operation");
};
const evaluator: ArrayMethodEvaluator = {
  callValue: unexpected,
  runMaybe: unexpected,
  resolveIterable: unexpected,
  getProperty: unexpected,
  recordHeapMutation: unexpected,
  callAlternatives: unexpected,
};
const joinItems = (items: StaticValue[]) =>
  callArrayMethod(evaluator, listValue(items), "join", [], createEvaluationContext(), null, []);
const getOptional = (index: number, predicate: string) =>
  optionalValue(primitiveValue(index), "present", null, false, predicate);

it("makes one decision for repeated identical presence predicates", () => {
  const predicate = createPathPredicate("shared", null);
  const result = joinItems(
    Array.from({ length: 5 }, (_value, index) => getOptional(index, predicate)),
  );
  expect(result?.kind).toBe("branch");
  if (result?.kind === "branch")
    expect(result.alternatives).toEqual([primitiveValue("0,1,2,3,4"), primitiveValue("")]);
});
const getEquivalentPredicates = () => {
  const shared = parseSymbolicPredicate(createPathPredicate("shared with metadata", null));
  return Array.from({ length: 6 }, (_value, index) =>
    serializeSymbolicPredicate({
      ...shared,
      inputs: [
        ...shared.inputs,
        ...parseSymbolicPredicate(createPathPredicate(`metadata ${index}`, null)).inputs,
      ],
    }),
  );
};
it("shares equivalent decisions while retaining all input metadata and preference", () => {
  const predicates = getEquivalentPredicates();
  const result = joinItems(
    predicates.map((predicate, index) =>
      optionalValue(primitiveValue(index), "present", null, true, predicate),
    ),
  );
  expect(result?.kind).toBe("branch");
  if (result?.kind !== "branch") return;
  expect(result.alternatives).toEqual([primitiveValue("0,1,2,3,4,5"), primitiveValue("")]);
  expect(result.preferredIndex).toBe(1);
  expect(new Set(getAlternativeGuards(result)?.inputs.map((input) => input.id))).toEqual(
    new Set(
      predicates.flatMap((predicate) =>
        parseSymbolicPredicate(predicate).inputs.map((input) => input.id),
      ),
    ),
  );
});
it("keeps the raw independent-choice bound when equivalent metadata differs", () => {
  const items = getEquivalentPredicates().map((predicate, index) => getOptional(index, predicate));
  items.push(
    ...Array.from({ length: 4 }, (_value, index) =>
      getOptional(index + 6, createPathPredicate(`independent metadata control ${index}`, null)),
    ),
  );
  expect(joinItems(items)).toMatchObject({
    kind: "unknown-primitive",
    reason: "join of a list with many uncertain items",
  });
});
it("retains sixteen independent join combinations", () => {
  const result = joinItems(
    Array.from({ length: 4 }, (_value, index) =>
      getOptional(index, createPathPredicate(`independent ${index}`, null)),
    ),
  );
  expect(result?.kind).toBe("branch");
  if (result?.kind === "branch") expect(result.alternatives).toHaveLength(16);
});
it("still refuses thirty-two independent join combinations", () => {
  const result = joinItems(
    Array.from({ length: 5 }, (_value, index) =>
      getOptional(index, createPathPredicate(`independent ${index}`, null)),
    ),
  );
  expect(result).toMatchObject({
    kind: "unknown-primitive",
    primitiveType: "string",
    reason: "join of a list with many uncertain items",
  });
});
it("does not let a repeated predicate remove independent decisions", () => {
  const shared = createPathPredicate("shared", null);
  const items = Array.from({ length: 5 }, (_value, index) => getOptional(index, shared));
  items.push(
    ...Array.from({ length: 4 }, (_value, index) =>
      getOptional(index + 5, createPathPredicate(`independent ${index}`, null)),
    ),
  );
  expect(joinItems(items)).toMatchObject({
    kind: "unknown-primitive",
    reason: "join of a list with many uncertain items",
  });
});

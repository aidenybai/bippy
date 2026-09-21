import { expect, it } from "vite-plus/test";
import { applyBinaryOperator } from "../src/evaluate/operators.js";
import { createPathPredicate } from "../src/evaluate/predicates.js";
import { branchValue, objectValue, primitiveValue } from "../src/evaluate/values.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

it.each([4, 5])("retains the raw %i by four prototype product bound", (count) => {
  const prototypes = Array.from({ length: 4 }, () => objectValue());
  const instances = Array.from({ length: count }, (_value, index) => ({
    ...objectValue(),
    prototype: prototypes[index % 4],
  }));
  const constructor = createCallbackValue(createEvaluationContext());
  constructor.properties = objectValue([
    { kind: "property", key: "prototype", value: branchValue(prototypes, "prototypes") },
  ]);
  const result = applyBinaryOperator(
    "instanceof",
    branchValue(instances, "instances"),
    constructor,
  );
  expect(result.kind).toBe(count === 4 ? "branch" : "unknown-primitive");
});
it("correlates instance and constructor prototype choices", () => {
  const prototypes = [objectValue(), objectValue()];
  const predicate = createPathPredicate("prototype choice", null);
  const constructor = createCallbackValue(createEvaluationContext());
  constructor.properties = objectValue([
    {
      kind: "property",
      key: "prototype",
      value: branchValue(prototypes, "prototypes", null, 1, predicate),
    },
  ]);
  const instances = branchValue(
    prototypes.map((prototype) => ({ ...objectValue(), prototype })),
    "instances",
    null,
    1,
    predicate,
  );
  expect(applyBinaryOperator("instanceof", instances, constructor)).toEqual(primitiveValue(true));
});

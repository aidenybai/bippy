import { expect, it } from "vite-plus/test";
import { COMPLETES, mergeOutcomes, returnOutcome } from "../src/evaluate/interpreter.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { getCaughtValue, getThrownPaths, withoutThrows } from "../src/evaluate/thrown.js";
import {
  branchValue,
  FALSE_VALUE,
  primitiveValue,
  thrownValue,
  TRUE_VALUE,
} from "../src/evaluate/values.js";

it("preserves the completing condition when the other path throws", () => {
  const predicate = createPathPredicate("throw or complete", null);
  const outcome = mergeOutcomes(
    [returnOutcome(thrownValue("failed", primitiveValue("failed"))), COMPLETES],
    "throw or complete",
    null,
    0,
    predicate,
  );
  expect(outcome.mayComplete).toBe(true);
  expect(outcome.completion).toMatchObject({
    kind: "branch",
    predicate,
    alternatives: [FALSE_VALUE, TRUE_VALUE],
    preferredIndex: 1,
  });
});

it("preserves original choices and preference when selecting error payloads", () => {
  const value = branchValue(
    [
      thrownValue("first", primitiveValue("first")),
      primitiveValue("returned"),
      thrownValue("last", primitiveValue("last")),
    ],
    "outcomes",
    null,
    2,
  );
  if (value.kind !== "branch") throw new Error("Expected alternatives");
  const original = getAlternativeGuards(value);
  const selected = getThrownPaths(value);
  if (!original || selected?.kind !== "branch") throw new Error("Expected guarded errors");
  expect(selected.preferredIndex).toBe(1);
  expect(getAlternativeGuards(selected)).toEqual({
    inputs: original.inputs,
    guards: [original.guards[0], original.guards[2]],
  });
  const caught = getCaughtValue(selected, null);
  if (caught.kind !== "branch") throw new Error("Expected guarded payloads");
  expect(caught.alternatives).toEqual([primitiveValue("first"), primitiveValue("last")]);
  expect(getAlternativeGuards(caught)).toEqual(getAlternativeGuards(selected));
});

it("preserves the surviving choices when removing thrown alternatives", () => {
  const value = branchValue(
    [
      primitiveValue("first"),
      thrownValue("failed", primitiveValue("failed")),
      primitiveValue("last"),
    ],
    "outcomes",
    null,
    2,
  );
  if (value.kind !== "branch") throw new Error("Expected alternatives");
  const original = getAlternativeGuards(value);
  const selected = withoutThrows(value);
  if (!original || selected.kind !== "branch") throw new Error("Expected surviving alternatives");
  expect(selected.preferredIndex).toBe(1);
  expect(selected.alternatives).toEqual([primitiveValue("first"), primitiveValue("last")]);
  expect(getAlternativeGuards(selected)).toEqual({
    inputs: original.inputs,
    guards: [original.guards[0], original.guards[2]],
  });
});

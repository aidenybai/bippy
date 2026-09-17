import { describe, expect, it } from "vite-plus/test";
import {
  createPathPredicate,
  getAlternativeGuards,
  getTruthinessPredicate,
  recordNegation,
  recordRefinement,
} from "../src/evaluate/predicates.js";
import {
  UNDEFINED_VALUE,
  branchValue,
  primitiveValue,
  unknownValue,
} from "../src/evaluate/values.js";
import { andGuard, predicateGuards } from "../src/symbolic/guards.js";
import { parseSymbolicPredicate } from "../src/symbolic/serialization.js";

describe("truthiness predicates", () => {
  it("names a negation as the opposite side of its operand", () => {
    const operand = unknownValue("flag");
    const negated = recordNegation(unknownValue("!flag"), operand);
    expect(getTruthinessPredicate(negated)).toBe(getTruthinessPredicate(operand, true));
    expect(getTruthinessPredicate(recordNegation(unknownValue("!!flag"), negated))).toBe(
      getTruthinessPredicate(operand),
    );
  });

  it("names a refinement after the value it narrows", () => {
    const subject = branchValue([unknownValue("a"), UNDEFINED_VALUE], "test");
    const refined = branchValue([unknownValue("a"), primitiveValue(0)], "test");
    recordRefinement(refined, subject);
    expect(getTruthinessPredicate(refined)).toBe(getTruthinessPredicate(subject));
  });

  it("refuses refinements and negations that would cycle back to themselves", () => {
    const first = branchValue([unknownValue("a"), UNDEFINED_VALUE], "test");
    const second = branchValue([unknownValue("b"), UNDEFINED_VALUE], "test");
    recordRefinement(second, first);
    recordRefinement(first, second);
    expect(getTruthinessPredicate(first)).toBe(getTruthinessPredicate(second));
    const negated = recordNegation(unknownValue("!a"), first);
    recordNegation(first, negated);
    expect(getTruthinessPredicate(negated)).toBe(getTruthinessPredicate(first, true));
  });
});

describe("flattened predicates", () => {
  it("keeps the causes of three distinct values", () => {
    const first = createPathPredicate("first", null);
    const second = createPathPredicate("second", null);
    const firstGuards = predicateGuards(parseSymbolicPredicate(first), 2);
    const secondGuards = predicateGuards(parseSymbolicPredicate(second), 2);
    const inner = branchValue([primitiveValue(1), primitiveValue(0)], "first", null, 0, first);
    const value = branchValue([primitiveValue(2), inner], "second", null, 0, second);
    expect(value.kind).toBe("branch");
    if (value.kind !== "branch") return;
    expect(value.alternatives).toEqual([primitiveValue(2), primitiveValue(1), primitiveValue(0)]);
    expect(getAlternativeGuards(value)?.guards).toEqual([
      secondGuards[0],
      andGuard([secondGuards[1], firstGuards[0]]),
      andGuard([secondGuards[1], firstGuards[1]]),
    ]);
    expect(getAlternativeGuards(value)?.inputs).toHaveLength(2);
  });

  it("reuses resolved guards until the predicate or alternative count changes", () => {
    const predicate = createPathPredicate("first", null);
    const value = branchValue([primitiveValue(1), primitiveValue(0)], "first", null, 0, predicate);
    expect(value.kind).toBe("branch");
    if (value.kind !== "branch") return;
    const initial = getAlternativeGuards(value);
    expect(getAlternativeGuards(value)).toBe(initial);
    value.predicate = createPathPredicate("second", null);
    const changed = getAlternativeGuards(value);
    expect(changed).not.toBe(initial);
    expect(changed?.inputs[0].label).toBe("second");
    value.alternatives.push(primitiveValue(2));
    expect(getAlternativeGuards(value)?.guards).toHaveLength(3);
  });

  it("accepts serialized predicates predating per-alternative guards", () => {
    const serialized = JSON.stringify({
      formula: { kind: "constant", value: true },
      choice: null,
      inputs: [],
    });
    expect(parseSymbolicPredicate(serialized)).toEqual({
      formula: { kind: "constant", value: true },
      choice: null,
      guards: null,
      inputs: [],
    });
  });
});

import { describe, expect, it } from "vite-plus/test";
import {
  getNegatedPredicate,
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

describe("truthiness predicates", () => {
  it("names a negation as the opposite side of its operand", () => {
    const operand = unknownValue("flag");
    const negated = recordNegation(unknownValue("!flag"), operand);
    expect(getTruthinessPredicate(negated)).toBe(
      getNegatedPredicate(getTruthinessPredicate(operand)),
    );
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
    expect(getTruthinessPredicate(negated)).toBe(
      getNegatedPredicate(getTruthinessPredicate(first)),
    );
  });
});

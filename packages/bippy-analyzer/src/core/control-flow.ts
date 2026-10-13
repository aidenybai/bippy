import type { BlockId, Terminal } from "../react-compiler/HIR/HIR";
import type { Branch, ConditionalValue, SymbolicValue, TestKind } from "./types";
import { getTestExpression, negate } from "./utils/truthiness";
import { getValueKey } from "./utils/value-key";

export type Outcome =
  | { kind: "Return"; value: SymbolicValue }
  | { kind: "Fallthrough"; from: BlockId | null; to: BlockId }
  | SplitOutcome;

export interface SplitOutcome {
  kind: "Split";
  test: SymbolicValue;
  testKind: TestKind;
  branch: Branch;
  consequent: Outcome;
  alternate: Outcome;
}

export type BranchTerminal = Extract<Terminal, { kind: "if" | "branch" }>;

export const createConditional = (
  split: SplitOutcome,
  guards: SymbolicValue[],
  toArm: (arm: Outcome, armGuards: SymbolicValue[]) => SymbolicValue,
): ConditionalValue => ({
  kind: "Conditional",
  test: split.test,
  testKind: split.testKind,
  consequent: toArm(split.consequent, [...guards, getGuard(split, true)]),
  alternate: toArm(split.alternate, [...guards, getGuard(split, false)]),
  branch: split.branch,
  guardKeys: guards.map(getValueKey),
});

export const isFallthroughOnly = (outcome: Outcome, join: BlockId): boolean =>
  outcome.kind === "Split"
    ? isFallthroughOnly(outcome.consequent, join) && isFallthroughOnly(outcome.alternate, join)
    : outcome.kind === "Fallthrough" && outcome.to === join;

export const hasFallthrough = (outcome: Outcome, join: BlockId): boolean =>
  outcome.kind === "Split"
    ? hasFallthrough(outcome.consequent, join) || hasFallthrough(outcome.alternate, join)
    : outcome.kind === "Fallthrough" && outcome.to === join;

export const NO_STOPS: ReadonlySet<BlockId> = new Set();

export const getGuard = (split: SplitOutcome, isConsequent: boolean): SymbolicValue => {
  const test = getTestExpression(split);
  return isConsequent ? test : negate(test);
};

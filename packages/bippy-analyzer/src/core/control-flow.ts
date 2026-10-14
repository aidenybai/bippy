import type { BlockId, Terminal } from "../react-compiler/HIR/HIR";
import type { Branch, ConditionalValue, SymbolicValue, TestKind } from "./types";
import { getTestExpression, negate } from "./utils/truthiness";
import { getValueKey } from "./utils/value-key";

interface ReturnOutcome {
  kind: "Return";
  value: SymbolicValue;
}

interface FallthroughOutcome {
  kind: "Fallthrough";
  from: BlockId | null;
  to: BlockId;
}

export type Outcome = ReturnOutcome | FallthroughOutcome | SplitOutcome;

interface SplitOutcome {
  kind: "Split";
  test: SymbolicValue;
  testKind: TestKind;
  branch: Branch;
  consequent: Outcome;
  alternate: Outcome;
}

export type BranchTerminal = Extract<Terminal, { kind: "if" | "branch" }>;

export type SwitchTerminal = Extract<Terminal, { kind: "switch" }>;

export type LoopTerminal = Extract<
  Terminal,
  { kind: "for" | "for-of" | "for-in" | "while" | "do-while" }
>;

export const getLoopHeaders = (terminal: LoopTerminal): BlockId[] => {
  switch (terminal.kind) {
    case "for":
      return [terminal.init, terminal.test, ...(terminal.update === null ? [] : [terminal.update])];
    case "for-of":
      return [terminal.init, terminal.test];
    case "for-in":
      return [terminal.init];
    case "while":
      return [terminal.test];
    case "do-while":
      return [terminal.loop, terminal.test];
  }
};

export const getLoopExit = (terminal: LoopTerminal): BlockId =>
  terminal.kind === "for-in" ? terminal.init : terminal.test;

export const mapFallthroughs = (
  outcome: Outcome,
  mapFallthrough: (fallthrough: FallthroughOutcome) => Outcome,
): Outcome => {
  if (outcome.kind === "Fallthrough") return mapFallthrough(outcome);
  if (outcome.kind === "Return") return outcome;
  return {
    ...outcome,
    consequent: mapFallthroughs(outcome.consequent, mapFallthrough),
    alternate: mapFallthroughs(outcome.alternate, mapFallthrough),
  };
};

export const createConditional = (
  split: SplitOutcome,
  guards: SymbolicValue[],
  getArmValue: (arm: Outcome, armGuards: SymbolicValue[]) => SymbolicValue,
): ConditionalValue => ({
  kind: "Conditional",
  test: split.test,
  testKind: split.testKind,
  consequent: getArmValue(split.consequent, [...guards, getGuard(split, true)]),
  alternate: getArmValue(split.alternate, [...guards, getGuard(split, false)]),
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

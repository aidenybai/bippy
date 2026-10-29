import type {
  BlockId,
  IdentifierId,
  Place,
  SourceLocation,
  Terminal,
} from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { Binding, Branch, ConditionalValue, SymbolicValue, TestKind } from "../types";
import { createUnknown } from "../values/symbolic-values";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { negate } from "../values/negate";
import { getValueKey } from "../values/get-value-key";
import { getLocationKey } from "../shared/get-location-key";
import { memoizeByIdentity } from "../shared/memoize-by-identity";

interface ReturnOutcome {
  kind: "Return";
  value: SymbolicValue;
  contextValues?: ReadonlyMap<IdentifierId, ContextValue>;
}

export interface FallthroughOutcome {
  kind: "Fallthrough";
  from: BlockId | null;
  to: BlockId;
  contextValues?: ReadonlyMap<IdentifierId, ContextValue>;
}

export interface ContextValue {
  place: Place;
  value: SymbolicValue;
}

export type Outcome = ReturnOutcome | FallthroughOutcome | SplitOutcome;

export interface SplitOutcome {
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

const isWithin = (loc: SourceLocation, range: SourceLocation): boolean =>
  loc !== GeneratedSource &&
  range !== GeneratedSource &&
  loc.start.index >= range.start.index &&
  loc.end.index <= range.end.index;

const isIterationTest = (
  test: SymbolicValue,
  loopBindings: Binding[],
  loopLoc: SourceLocation,
): boolean => {
  const loopBindingIds = new Set(loopBindings.map((binding) => binding.id));
  const readsLoopBinding = (binding: Binding): boolean =>
    loopBindingIds.has(binding.id) ||
    binding.inputPlaces.some((place) => loopBindingIds.has(place.bindingId));
  let isIteration = false;
  forEachSymbolicValue(test, (part) => {
    if (part.kind === "Binding" && readsLoopBinding(part.binding)) isIteration = true;
    if (part.kind === "Unknown" && isWithin(part.loc, loopLoc)) isIteration = true;
  });
  return isIteration;
};

const isOpaqueLoopSplit = (outcome: Outcome): outcome is SplitOutcome =>
  outcome.kind === "Split" && outcome.test.kind === "Unknown" && outcome.test.reason === "loop";

export const collapseLoopSplits = (
  outcome: Outcome,
  loopBindings: Binding[],
  loopLoc: SourceLocation,
): Outcome => {
  if (outcome.kind !== "Split") return outcome;
  const consequent = collapseLoopSplits(outcome.consequent, loopBindings, loopLoc);
  const alternate = collapseLoopSplits(outcome.alternate, loopBindings, loopLoc);
  if (!isIterationTest(outcome.test, loopBindings, loopLoc))
    return { ...outcome, consequent, alternate };
  const opaque: SplitOutcome = {
    ...outcome,
    test: createUnknown("loop", outcome.branch.loc),
    testKind: "truthy",
    consequent,
    alternate,
  };
  if (isOpaqueLoopSplit(consequent) && consequent.alternate === alternate)
    return { ...opaque, consequent: consequent.consequent };
  if (isOpaqueLoopSplit(alternate) && alternate.consequent === consequent)
    return { ...opaque, alternate: alternate.alternate };
  return opaque;
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

export const getBranchKey = memoizeByIdentity(
  (branch: Branch): string =>
    `${branch.file}:${getLocationKey(branch.loc)}:${branch.terminalId}${branch.caseIndex === undefined ? "" : `#${branch.caseIndex}`}${branch.rowScope === undefined ? "" : `@${branch.rowScope}`}`,
);

export const getGuard = (split: SplitOutcome, isConsequent: boolean): SymbolicValue => {
  const test = getTestExpression(split);
  return isConsequent ? test : negate(test);
};

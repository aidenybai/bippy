import type {
  BlockId,
  IdentifierId,
  Place,
  SourceLocation,
  Terminal,
} from "../../react-compiler/HIR/HIR";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { Binding, BranchSite, ConditionalValue, SymbolicValue, TestKind } from "../types";
import { createUnknown } from "../values/symbolic-values";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { negate } from "../values/negate";

interface ReturnCompletion {
  kind: "Return";
  value: SymbolicValue;
  contextValues?: ReadonlyMap<IdentifierId, ContextValue>;
}

export interface FallthroughCompletion {
  kind: "Fallthrough";
  from: BlockId | null;
  to: BlockId;
  contextValues?: ReadonlyMap<IdentifierId, ContextValue>;
}

export interface ContextValue {
  place: Place;
  value: SymbolicValue;
}

export type Completion = ReturnCompletion | FallthroughCompletion | SplitCompletion;

export interface SplitCompletion {
  kind: "Split";
  test: SymbolicValue;
  testKind: TestKind;
  branch: BranchSite;
  consequent: Completion;
  alternate: Completion;
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
  completion: Completion,
  mapFallthrough: (fallthrough: FallthroughCompletion) => Completion,
): Completion => {
  if (completion.kind === "Fallthrough") return mapFallthrough(completion);
  if (completion.kind === "Return") return completion;
  return {
    ...completion,
    consequent: mapFallthroughs(completion.consequent, mapFallthrough),
    alternate: mapFallthroughs(completion.alternate, mapFallthrough),
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

const isOpaqueLoopSplit = (completion: Completion): completion is SplitCompletion =>
  completion.kind === "Split" &&
  completion.test.kind === "Unknown" &&
  completion.test.reason === "loop";

export const collapseLoopSplits = (
  completion: Completion,
  loopBindings: Binding[],
  loopLoc: SourceLocation,
): Completion => {
  if (completion.kind !== "Split") return completion;
  const consequent = collapseLoopSplits(completion.consequent, loopBindings, loopLoc);
  const alternate = collapseLoopSplits(completion.alternate, loopBindings, loopLoc);
  if (!isIterationTest(completion.test, loopBindings, loopLoc))
    return { ...completion, consequent, alternate };
  const opaque: SplitCompletion = {
    ...completion,
    test: createUnknown("loop", completion.branch.loc),
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
  split: SplitCompletion,
  guards: SymbolicValue[],
  getEdgeValue: (edge: Completion, edgeGuards: SymbolicValue[]) => SymbolicValue,
): ConditionalValue => ({
  kind: "Conditional",
  test: split.test,
  testKind: split.testKind,
  consequent: getEdgeValue(split.consequent, [...guards, getGuard(split, true)]),
  alternate: getEdgeValue(split.alternate, [...guards, getGuard(split, false)]),
  branch: split.branch,
});

export const isFallthroughOnly = (completion: Completion, join: BlockId): boolean =>
  completion.kind === "Split"
    ? isFallthroughOnly(completion.consequent, join) &&
      isFallthroughOnly(completion.alternate, join)
    : completion.kind === "Fallthrough" && completion.to === join;

export const hasFallthrough = (completion: Completion, join: BlockId): boolean =>
  completion.kind === "Split"
    ? hasFallthrough(completion.consequent, join) || hasFallthrough(completion.alternate, join)
    : completion.kind === "Fallthrough" && completion.to === join;

export const NO_STOPS: ReadonlySet<BlockId> = new Set();

export const getGuard = (split: SplitCompletion, isConsequent: boolean): SymbolicValue => {
  const test = getTestExpression(split);
  return isConsequent ? test : negate(test);
};

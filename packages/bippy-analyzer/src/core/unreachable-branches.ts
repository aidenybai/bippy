import type { ConditionalValue, SymbolicValue, UnreachableBranch } from "./types";
import { forEachRenderNode, forEachSymbolicValue } from "./utils/traverse";
import { formatNegated, formatSymbolicValue } from "./format";
import { getValueKey } from "./utils/value-key";
import { getTestExpression, negate } from "./utils/truthiness";
import { isRenderingNothingWhenFalse } from "./utils/checks";
import { getBranchKey } from "./regions";

export interface BranchOutcomes extends Map<string, Set<boolean>> {}

interface KeyedUnreachableBranch extends UnreachableBranch {
  branchKey: string;
}

const collectBranchKeysInTests = (render: SymbolicValue): Set<string> => {
  const branchKeysInTests = new Set<string>();
  forEachRenderNode(render, (value) => {
    if (value.kind !== "Conditional") return;
    forEachSymbolicValue(getTestExpression(value), (part) => {
      if (part.kind === "Conditional") branchKeysInTests.add(getBranchKey(part));
    });
  });
  return branchKeysInTests;
};

const getUnreachedSides = (
  conditional: ConditionalValue,
  branchKey: string,
  reachedOutcomes: Set<boolean>,
): KeyedUnreachableBranch[] => {
  const test = getTestExpression(conditional);
  const unreachedSides: KeyedUnreachableBranch[] = [];
  if (!reachedOutcomes.has(true))
    unreachedSides.push({
      branchKey,
      branch: conditional.branch,
      isTrueSide: true,
      description: `never ${formatSymbolicValue(test)}`,
    });
  if (!reachedOutcomes.has(false) && !isRenderingNothingWhenFalse(conditional))
    unreachedSides.push({
      branchKey,
      branch: conditional.branch,
      isTrueSide: false,
      description: `never ${formatNegated(test)}`,
    });
  return unreachedSides;
};

export const collectUnreachableBranches = (
  render: SymbolicValue,
  branchOutcomes: BranchOutcomes,
): UnreachableBranch[] => {
  const unreachableBranches: KeyedUnreachableBranch[] = [];
  const skippedBranchKeys = collectBranchKeysInTests(render);
  const displacedKeys = new Set<string>();
  const conditionsByValue = new WeakMap<SymbolicValue, Set<string>>();
  const visit = (value: SymbolicValue, conditions: string[]): void => {
    const knownConditions = conditionsByValue.get(value);
    if (knownConditions && conditions.every((condition) => knownConditions.has(condition))) return;
    const pathConditions = new Set([...(knownConditions ?? []), ...conditions]);
    conditionsByValue.set(value, pathConditions);
    switch (value.kind) {
      case "Conditional": {
        const branchKey = getBranchKey(value);
        const isRenderedOutsideItsGuards = [...pathConditions].some(
          (condition) => !value.guardKeys.includes(condition),
        );
        if (isRenderedOutsideItsGuards) displacedKeys.add(branchKey);
        const reachedOutcomes = branchOutcomes.get(branchKey);
        const test = getTestExpression(value);
        if (reachedOutcomes && !skippedBranchKeys.has(branchKey)) {
          skippedBranchKeys.add(branchKey);
          unreachableBranches.push(...getUnreachedSides(value, branchKey, reachedOutcomes));
        }
        if (reachedOutcomes?.has(true))
          visit(value.consequent, [...pathConditions, getValueKey(test)]);
        if (reachedOutcomes?.has(false))
          visit(value.alternate, [...pathConditions, getValueKey(negate(test))]);
        return;
      }
      case "JsxExpression":
      case "JsxFragment":
        for (const child of value.children) visit(child, [...pathConditions]);
        return;
      default:
        return;
    }
  };
  visit(render, []);
  return unreachableBranches.flatMap(({ branchKey, ...unreachableBranch }) =>
    displacedKeys.has(branchKey) ? [] : [unreachableBranch],
  );
};

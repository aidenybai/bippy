import type { ConditionalValue, SymbolicValue, UnreachableBranch } from "./types";
import { forEachRenderNode, forEachSymbolicValue } from "./utils/traverse";
import { formatNegated, formatSymbolicValue } from "./format";
import { getValueKey } from "./utils/value-key";
import { getTestExpression, negate } from "./utils/truthiness";
import { isRenderingNothingWhenFalse } from "./utils/checks";
import { getBranchKey } from "./control-flow";

export interface BranchOutcomes extends Map<string, Set<boolean>> {}

interface KeyedUnreachableBranch extends UnreachableBranch {
  branchKey: string;
}

const collectBranchKeysInTests = (render: SymbolicValue): Set<string> => {
  const branchKeysInTests = new Set<string>();
  forEachRenderNode(render, (value) => {
    if (value.kind !== "Conditional") return;
    forEachSymbolicValue(getTestExpression(value), (part) => {
      if (part.kind === "Conditional") branchKeysInTests.add(getBranchKey(part.branch));
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

class UnreachableBranchCollector {
  readonly #branchOutcomes: BranchOutcomes;
  readonly #skippedBranchKeys: Set<string>;
  readonly #unreachableBranches: KeyedUnreachableBranch[] = [];
  readonly #displacedKeys = new Set<string>();
  readonly #conditionsByValue = new WeakMap<SymbolicValue, Set<string>>();

  constructor(render: SymbolicValue, branchOutcomes: BranchOutcomes) {
    this.#branchOutcomes = branchOutcomes;
    this.#skippedBranchKeys = collectBranchKeysInTests(render);
    this.#visit(render, []);
  }

  get unreachableBranches(): UnreachableBranch[] {
    return this.#unreachableBranches.flatMap(({ branchKey, ...unreachableBranch }) =>
      this.#displacedKeys.has(branchKey) ? [] : [unreachableBranch],
    );
  }

  #visit(value: SymbolicValue, conditions: string[]): void {
    const knownConditions = this.#conditionsByValue.get(value);
    if (knownConditions && conditions.every((condition) => knownConditions.has(condition))) return;
    const pathConditions = new Set([...(knownConditions ?? []), ...conditions]);
    this.#conditionsByValue.set(value, pathConditions);
    if (value.kind === "Conditional") this.#visitConditional(value, [...pathConditions]);
    if (value.kind === "JsxExpression" || value.kind === "JsxFragment")
      for (const child of value.children) this.#visit(child, [...pathConditions]);
  }

  #visitConditional(conditional: ConditionalValue, pathConditions: string[]): void {
    const branchKey = getBranchKey(conditional.branch);
    const isRenderedOutsideItsGuards = pathConditions.some(
      (condition) => !conditional.guardKeys.includes(condition),
    );
    if (isRenderedOutsideItsGuards) this.#displacedKeys.add(branchKey);
    const reachedOutcomes = this.#branchOutcomes.get(branchKey);
    const test = getTestExpression(conditional);
    if (reachedOutcomes && !this.#skippedBranchKeys.has(branchKey)) {
      this.#skippedBranchKeys.add(branchKey);
      this.#unreachableBranches.push(...getUnreachedSides(conditional, branchKey, reachedOutcomes));
    }
    if (reachedOutcomes?.has(true))
      this.#visit(conditional.consequent, [...pathConditions, getValueKey(test)]);
    if (reachedOutcomes?.has(false))
      this.#visit(conditional.alternate, [...pathConditions, getValueKey(negate(test))]);
  }
}

export const collectUnreachableBranches = (
  render: SymbolicValue,
  branchOutcomes: BranchOutcomes,
): UnreachableBranch[] =>
  new UnreachableBranchCollector(render, branchOutcomes).unreachableBranches;

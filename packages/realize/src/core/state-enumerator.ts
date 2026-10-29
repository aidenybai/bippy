import { isComplementNegation } from "./bound-graph";
import {
  assumeCondition,
  evaluateCondition,
  getConstraintsKey,
  resolveLiteral,
} from "./constraints";
import type { Constraints } from "./constraints";
import { getBranchKey } from "./control-flow";
import { formatNegated, formatSymbolicValue } from "./format";
import type { RegionBranches } from "./regions";
import type { ConditionalValue, JsxContainerValue, SymbolicValue } from "./types";
import type { BranchOutcomes } from "./unreachable-branches";
import { getTestExpression } from "./utils/get-test-expression";
import { mapSymbolicValue } from "./utils/map-symbolic-value";
import { getFirstRenderOutcome } from "./reachable-constraints";
import { getOutcomeKey } from "./branch-outcome";

const MAX_ALTERNATIVES = 256;

export interface Alternative {
  constraints: Constraints;
  render: SymbolicValue;
  fragments: SymbolicValue[];
  conditions: string[];
  branches: ReadonlySet<string>;
  distanceFromFirstRender: number;
  hasUndecidedBranch: boolean;
}

export interface FirstRenderOutcomes {
  constraints: Constraints;
  outcomesByBranchKey: Map<string, boolean | null>;
}

interface PartialChildren extends Omit<Alternative, "render"> {
  children: SymbolicValue[];
}

const NO_BRANCHES: ReadonlySet<string> = new Set();

const constraintsKeys = new WeakMap<Constraints, string>();

export const getCachedConstraintsKey = (constraints: Constraints): string => {
  const cachedKey = constraintsKeys.get(constraints);
  if (cachedKey !== undefined) return cachedKey;
  const constraintsKey = getConstraintsKey(constraints);
  constraintsKeys.set(constraints, constraintsKey);
  return constraintsKey;
};

const createLeaf = (constraints: Constraints, render: SymbolicValue): Alternative => ({
  constraints,
  render,
  fragments: [],
  conditions: [],
  branches: NO_BRANCHES,
  distanceFromFirstRender: 0,
  hasUndecidedBranch: false,
});

export const getStateKey = (alternative: Alternative): string =>
  [...alternative.branches].sort().join("|");

const simplifyDecidedConditionals = (
  value: SymbolicValue,
  constraints: Constraints,
): SymbolicValue =>
  mapSymbolicValue(value, (part) => {
    if (part.kind !== "Conditional") return part;
    const decidedOutcome = evaluateCondition(getTestExpression(part), constraints);
    if (decidedOutcome === null) return part;
    return decidedOutcome ? part.consequent : part.alternate;
  });

export class StateEnumerator {
  readonly #branchOutcomes: BranchOutcomes;
  readonly #region: RegionBranches;
  readonly #firstRender: FirstRenderOutcomes;
  readonly #shouldDescribeStates: boolean;
  readonly #alternativesCache = new WeakMap<SymbolicValue, WeakMap<Constraints, Alternative[]>>();
  #isTruncated = false;

  constructor(
    branchOutcomes: BranchOutcomes,
    region: RegionBranches,
    firstRender: FirstRenderOutcomes,
    shouldDescribeStates: boolean,
  ) {
    this.#branchOutcomes = branchOutcomes;
    this.#region = region;
    this.#firstRender = firstRender;
    this.#shouldDescribeStates = shouldDescribeStates;
  }

  get isTruncated(): boolean {
    return this.#isTruncated;
  }

  enumerate(value: SymbolicValue, constraints: Constraints): Alternative[] {
    let alternativesByConstraints = this.#alternativesCache.get(value);
    if (!alternativesByConstraints) {
      alternativesByConstraints = new WeakMap();
      this.#alternativesCache.set(value, alternativesByConstraints);
    }
    const cachedAlternatives = alternativesByConstraints.get(constraints);
    if (cachedAlternatives) return cachedAlternatives;
    const alternatives = this.#enumerateUncached(value, constraints);
    alternativesByConstraints.set(constraints, alternatives);
    return alternatives;
  }

  #enumerateUncached(value: SymbolicValue, constraints: Constraints): Alternative[] {
    switch (value.kind) {
      case "Conditional":
        return this.#enumerateBranch(value, constraints);
      case "JsxExpression":
      case "JsxFragment":
        return this.#enumerateChildren(value, constraints);
      default:
        return [createLeaf(constraints, resolveLiteral(value, constraints))];
    }
  }

  #keepNearestFirstRender(alternatives: Alternative[]): Alternative[] {
    if (alternatives.length <= MAX_ALTERNATIVES) return alternatives;
    this.#isTruncated = true;
    return [...alternatives]
      .sort((left, right) => left.distanceFromFirstRender - right.distanceFromFirstRender)
      .slice(0, MAX_ALTERNATIVES);
  }

  #recordOutcome(branchKey: string, isTrue: boolean): void {
    this.#branchOutcomes.set(
      branchKey,
      new Set([...(this.#branchOutcomes.get(branchKey) ?? []), isTrue]),
    );
  }

  #enumerateBranch(conditional: ConditionalValue, constraints: Constraints): Alternative[] {
    const branchKey = getBranchKey(conditional.branch);
    if (!this.#region.branchKeys.has(branchKey)) return [createLeaf(constraints, conditional)];
    const test = getTestExpression(conditional);
    const firstRenderOutcome = getFirstRenderOutcome(this.#firstRender, branchKey, test);
    const alternatives: Alternative[] = [];
    let feasibleArmCount = 0;
    for (const isTrue of [true, false]) {
      const withOutcome = assumeCondition(test, isTrue, constraints);
      if (!withOutcome) continue;
      this.#recordOutcome(branchKey, isTrue);
      const isFirstRenderArm =
        firstRenderOutcome === null ? feasibleArmCount === 0 : isTrue === firstRenderOutcome;
      feasibleArmCount++;
      const conditionLabel = this.#getConditionLabel(test, isTrue, constraints);
      const arm = isTrue ? conditional.consequent : conditional.alternate;
      for (const alternative of this.enumerate(arm, withOutcome))
        alternatives.push({
          ...alternative,
          fragments: this.#shouldDescribeStates ? [alternative.render] : [],
          conditions:
            conditionLabel === null
              ? alternative.conditions
              : [conditionLabel, ...alternative.conditions],
          branches: new Set([...alternative.branches, getOutcomeKey(branchKey, isTrue)]),
          distanceFromFirstRender: alternative.distanceFromFirstRender + (isFirstRenderArm ? 0 : 1),
          hasUndecidedBranch: alternative.hasUndecidedBranch || firstRenderOutcome === null,
        });
    }
    return this.#keepNearestFirstRender(alternatives);
  }

  #getConditionLabel(
    test: SymbolicValue,
    isTrue: boolean,
    constraints: Constraints,
  ): string | null {
    if (!this.#shouldDescribeStates || evaluateCondition(test, constraints) !== null) return null;
    const simplifiedTest = simplifyDecidedConditionals(test, constraints);
    return isTrue
      ? formatSymbolicValue(simplifiedTest)
      : formatNegated(simplifiedTest, (comparison) =>
          isComplementNegation(comparison, constraints),
        );
  }

  #enumerateChildren(element: JsxContainerValue, constraints: Constraints): Alternative[] {
    const emptyPartial: PartialChildren = {
      constraints,
      children: [],
      fragments: [],
      conditions: [],
      branches: NO_BRANCHES,
      distanceFromFirstRender: 0,
      hasUndecidedBranch: false,
    };
    const partials =
      this.#combineChildrenInOrder(element.children, emptyPartial) ??
      this.#combineChildrenNearestFirstRender(element.children, emptyPartial);
    return partials.map((partial) => ({
      constraints: partial.constraints,
      render: this.#shouldDescribeStates ? { ...element, children: partial.children } : element,
      fragments: partial.fragments,
      conditions: partial.conditions,
      branches: partial.branches,
      distanceFromFirstRender: partial.distanceFromFirstRender,
      hasUndecidedBranch: partial.hasUndecidedBranch,
    }));
  }

  #extendPartial(partial: PartialChildren, childAlternative: Alternative): PartialChildren {
    return {
      constraints: childAlternative.constraints,
      children: this.#shouldDescribeStates
        ? [...partial.children, childAlternative.render]
        : partial.children,
      fragments: [...partial.fragments, ...childAlternative.fragments],
      conditions: [...partial.conditions, ...childAlternative.conditions],
      branches: new Set([...partial.branches, ...childAlternative.branches]),
      distanceFromFirstRender:
        partial.distanceFromFirstRender + childAlternative.distanceFromFirstRender,
      hasUndecidedBranch: partial.hasUndecidedBranch || childAlternative.hasUndecidedBranch,
    };
  }

  #combineChildrenInOrder(
    children: SymbolicValue[],
    emptyPartial: PartialChildren,
  ): PartialChildren[] | null {
    let partials = [emptyPartial];
    for (const child of children) {
      const nextPartials: PartialChildren[] = [];
      for (const partial of partials)
        for (const childAlternative of this.enumerate(child, partial.constraints)) {
          if (nextPartials.length >= MAX_ALTERNATIVES) {
            this.#isTruncated = true;
            return null;
          }
          nextPartials.push(this.#extendPartial(partial, childAlternative));
        }
      partials = nextPartials;
    }
    return partials;
  }

  #combineChildrenNearestFirstRender(
    children: SymbolicValue[],
    emptyPartial: PartialChildren,
  ): PartialChildren[] {
    const selected: PartialChildren[] = [];
    for (let distance = 0; selected.length < MAX_ALTERNATIVES; distance++) {
      const hasFartherCombinations = this.#collectAtDistance(
        children,
        0,
        emptyPartial,
        distance,
        selected,
      );
      if (!hasFartherCombinations) break;
    }
    return selected;
  }

  #collectAtDistance(
    children: SymbolicValue[],
    childIndex: number,
    partial: PartialChildren,
    remainingDistance: number,
    selected: PartialChildren[],
  ): boolean {
    const child = children[childIndex];
    if (!child) {
      if (remainingDistance === 0) selected.push(partial);
      return false;
    }
    let hasFartherCombinations = false;
    for (const childAlternative of this.enumerate(child, partial.constraints)) {
      if (selected.length >= MAX_ALTERNATIVES) break;
      if (childAlternative.distanceFromFirstRender > remainingDistance) {
        hasFartherCombinations = true;
        continue;
      }
      const isFarther = this.#collectAtDistance(
        children,
        childIndex + 1,
        this.#extendPartial(partial, childAlternative),
        remainingDistance - childAlternative.distanceFromFirstRender,
        selected,
      );
      hasFartherCombinations ||= isFarther;
    }
    return hasFartherCombinations;
  }
}

import { classify, describeCases, isBooleanDomain, isPrimitiveDomain } from "./claim-cases";
import type { ClaimContext } from "./claim-context";
import { assumeGuards } from "./claim-guards";
import { findClaimPath } from "./claim-path";
import { getHandlerStates } from "./claim-states";
import {
  assumeCondition,
  dedupeAbstractValues,
  evaluateCondition,
  getPossibleValues,
  hasUnknownPart,
  isBooleanExpression,
  type Constraints,
} from "./constraints";
import type {
  AbstractValue,
  Binding,
  Claim,
  ClaimOutcome,
  ConditionalValue,
  Handler,
  StateUpdate,
  SymbolicValue,
} from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getTestExpression } from "./utils/get-test-expression";
import { getValueKey } from "./utils/get-value-key";
import { isStateBinding } from "./utils/is-state-binding";

type Problem = Pick<ClaimOutcome, "verdict" | "reason">;

interface StateProblem extends Problem {
  stateIndex: number | null;
}

const createStateClaim = (
  context: ClaimContext,
  binding: Binding,
  cases: AbstractValue[],
): Claim => ({
  kind: "state",
  subject: { kind: "Binding", binding, path: [] },
  cases,
  test: null,
  guards: [],
  isInHandler: false,
  description: `${binding.name} stays within ${describeCases(cases)}`,
  loc: binding.loc,
  file: context.analysis.file,
});

const hasCastPart = (value: SymbolicValue): boolean => {
  let isCast = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Unknown" && part.reason === "cast") isCast = true;
  });
  return isCast;
};

const isLiteralValue = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" ||
  (value.kind === "Conditional" &&
    isLiteralValue(value.consequent) &&
    isLiteralValue(value.alternate));

const getSideValues = (
  value: SymbolicValue,
  constraints: Constraints | null,
): AbstractValue[] | null => (constraints ? getUpdateValues(value, constraints) : []);

const isNullish = (value: AbstractValue): boolean =>
  value.kind === "Literal"
    ? value.value === null || value.value === undefined
    : value.text === "undefined" || value.text === "null";

const isCoalescing = (value: ConditionalValue): boolean =>
  value.testKind === "nullish" && getValueKey(value.test) === getValueKey(value.consequent);

const getBranchValues = (
  value: ConditionalValue,
  constraints: Constraints,
): AbstractValue[] | null => {
  const test = getTestExpression(value);
  const decided = evaluateCondition(test, constraints);
  if (decided !== null)
    return getUpdateValues(decided ? value.consequent : value.alternate, constraints);
  const consequent = getSideValues(value.consequent, assumeCondition(test, true, constraints));
  const alternate = getSideValues(value.alternate, assumeCondition(test, false, constraints));
  if (!consequent || !alternate) return null;
  const kept = isCoalescing(value) ? consequent.filter((item) => !isNullish(item)) : consequent;
  return dedupeAbstractValues([...kept, ...alternate]);
};

const getUpdateValues = (
  value: SymbolicValue,
  constraints: Constraints,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind === "Conditional") return getBranchValues(value, constraints);
  return hasUnknownPart(value) ? null : getPossibleValues(value, constraints);
};

const checkUpdate = (
  cases: AbstractValue[],
  update: StateUpdate,
  constraints: Constraints,
): Problem | null => {
  const narrowed = assumeGuards(update.guards, constraints);
  if (!narrowed) return null;
  if (isBooleanDomain(cases) && isBooleanExpression(update.value)) return null;
  const values = getUpdateValues(update.value, narrowed);
  if (!values)
    return hasCastPart(update.value) ? { verdict: "unproven", reason: "set through a cast" } : null;
  const outside = values.filter((value) => classify(value, cases) !== "in");
  if (outside.length === 0) return null;
  return isLiteralValue(update.value)
    ? { verdict: "broken", reason: `set to ${describeCases(outside)}` }
    : { verdict: "unproven", reason: `may be set to ${describeCases(outside)}` };
};

const checkUpdateInStates = (
  cases: AbstractValue[],
  update: StateUpdate,
  handler: Handler,
  context: ClaimContext,
): StateProblem[] => {
  const stateIndexes = getHandlerStates(handler, context);
  if (stateIndexes === null) {
    const problem = checkUpdate(cases, update, context.reachable);
    return problem ? [{ ...problem, stateIndex: null }] : [];
  }
  return stateIndexes.flatMap((stateIndex): StateProblem[] => {
    const constraints = context.constraintsByState[stateIndex];
    const problem = constraints ? checkUpdate(cases, update, constraints) : null;
    return problem ? [{ ...problem, stateIndex }] : [];
  });
};

const checkStateClaim = (
  binding: Binding,
  cases: AbstractValue[],
  context: ClaimContext,
): ClaimOutcome => {
  const claim = createStateClaim(context, binding, cases);
  const problems = context.analysis.handlers.flatMap((handler) =>
    handler.updates
      .filter((update) => update.binding.id === binding.id)
      .flatMap((update) => checkUpdateInStates(cases, update, handler, context)),
  );
  const found = problems.find((problem) => problem.verdict === "broken") ?? problems.at(0) ?? null;
  if (!found) return { claim, verdict: "holds", stateIndex: null, path: [], reason: null };
  const path =
    found.stateIndex === null
      ? []
      : findClaimPath(context.states, context.regions, found.stateIndex);
  return { claim, ...found, path };
};

export const checkStateClaims = (context: ClaimContext): ClaimOutcome[] =>
  context.analysis.bindings.flatMap((binding): ClaimOutcome[] =>
    isStateBinding(binding) &&
    binding.domain.kind === "Cases" &&
    isPrimitiveDomain(binding.domain.cases)
      ? [checkStateClaim(binding, binding.domain.cases, context)]
      : [],
  );

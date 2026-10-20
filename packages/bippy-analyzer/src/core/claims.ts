import { classify, describeCases } from "./claim-cases";
import { getSymbolicValues } from "./claim-values";
import { createClaimContext, type ClaimContext } from "./claim-context";
import { assumeGuards } from "./claim-guards";
import { findClaimPath } from "./claim-path";
import { getClaimStates } from "./claim-states";
import { assumeCondition, evaluateCondition, type Constraints } from "./constraints";
import { formatSymbolicValue } from "./format";
import { checkStateClaims } from "./state-claims";
import type {
  AbstractValue,
  BindingPlace,
  Claim,
  ClaimOutcome,
  ComponentAnalysis,
  Region,
  State,
  SymbolicValue,
} from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getPlaceKey } from "./utils/get-place-key";
import { getTestExpression } from "./utils/get-test-expression";
import { getValueKey } from "./utils/get-value-key";
import { getValuePlace } from "./utils/get-value-place";
import { isPlacePrefix } from "./utils/is-place-prefix";

interface Check {
  outcome: boolean | null;
  witness: string | null;
}

interface StateCheck {
  stateIndex: number | null;
  check: Check;
}

const checkMembership = (claim: Claim, cases: AbstractValue[], constraints: Constraints): Check => {
  const values = getSymbolicValues(claim.subject, constraints);
  if (!values) return { outcome: null, witness: null };
  const memberships = values.map((value) => classify(value, cases));
  if (memberships.every((membership) => membership === "in"))
    return { outcome: true, witness: null };
  const open = values.filter((value) => classify(value, cases) !== "in");
  return {
    outcome: memberships.every((membership) => membership === "out") ? false : null,
    witness: `${formatSymbolicValue(claim.subject)} = ${describeCases(open)}`,
  };
};

const describeWitness = (test: SymbolicValue, constraints: Constraints): string | null => {
  const parts: string[] = [];
  const seen = new Set<string>();
  forEachSymbolicValue(test, (part) => {
    if (part.kind !== "Binding") return;
    const place = getValuePlace(part);
    if (seen.has(getPlaceKey(place))) return;
    seen.add(getPlaceKey(place));
    const values = constraints.possibleValues.get(place);
    if (values) parts.push(`${formatSymbolicValue(part)} = ${describeCases(values)}`);
  });
  return parts.length > 0 ? parts.join(", ") : null;
};

const assumeFalse = (test: SymbolicValue, constraints: Constraints): Constraints | null => {
  if (test.kind !== "Conditional") return assumeCondition(test, false, constraints);
  const condition = getTestExpression(test);
  const isOr = getValueKey(test.consequent) === getValueKey(condition);
  const isAnd = getValueKey(test.alternate) === getValueKey(condition);
  if (isOr) {
    const withoutLeft = assumeCondition(condition, false, constraints);
    return withoutLeft && assumeFalse(test.alternate, withoutLeft);
  }
  if (isAnd) {
    const withoutLeft = assumeCondition(condition, false, constraints);
    if (withoutLeft) return withoutLeft;
    const withLeft = assumeCondition(condition, true, constraints);
    return withLeft && assumeFalse(test.consequent, withLeft);
  }
  return assumeCondition(test, false, constraints);
};

const describeFailure = (test: SymbolicValue, failing: Constraints): string | null => {
  const witness = describeWitness(test, failing);
  if (witness !== null) return witness;
  return test.kind === "BinaryExpression" && test.operator === "!="
    ? `${formatSymbolicValue(test.left)} = ${formatSymbolicValue(test.right)}`
    : null;
};

const checkCondition = (test: SymbolicValue, constraints: Constraints): Check => {
  const outcome = evaluateCondition(test, constraints);
  if (outcome === false) return { outcome, witness: describeFailure(test, constraints) };
  if (outcome === true) return { outcome, witness: null };
  const failing = assumeFalse(test, constraints);
  if (!failing) return { outcome: true, witness: null };
  return { outcome: null, witness: describeFailure(test, failing) };
};

const getCallInputs = (guards: SymbolicValue[]): BindingPlace[] =>
  guards.flatMap((guard) => {
    const inputs: BindingPlace[] = [];
    forEachSymbolicValue(guard, (part) => {
      if (part.kind === "Binding" && part.binding.kind === "call")
        inputs.push(...part.binding.inputPlaces);
    });
    return inputs;
  });

const isGuardedByCall = (claim: Claim): boolean => {
  const inputs = getCallInputs(claim.guards);
  let isGuarded = false;
  forEachSymbolicValue(claim.subject, (part) => {
    if (part.kind !== "Binding") return;
    const place = getValuePlace(part);
    if (inputs.some((input) => isPlacePrefix(input, place) || isPlacePrefix(place, input)))
      isGuarded = true;
  });
  return isGuarded;
};

const checkClaim = (claim: Claim, constraints: Constraints): Check | null => {
  const narrowed = assumeGuards(claim.guards, constraints);
  if (!narrowed) return null;
  const check = claim.cases
    ? checkMembership(claim, claim.cases, narrowed)
    : claim.test
      ? checkCondition(claim.test, narrowed)
      : { outcome: null, witness: null };
  return check.outcome === false && isGuardedByCall(claim) ? { ...check, outcome: null } : check;
};

const toOutcome = (claim: Claim, checks: StateCheck[], context: ClaimContext): ClaimOutcome => {
  const broken = checks.find(({ check }) => check.outcome === false);
  const unproven = checks.find(({ check }) => check.outcome === null);
  const found = broken ?? unproven;
  if (!found)
    return {
      claim,
      verdict: "holds",
      stateIndex: null,
      path: [],
      reason: checks.length === 0 ? "never reached" : null,
    };
  return {
    claim,
    verdict: broken ? "broken" : "unproven",
    stateIndex: found.stateIndex,
    path:
      found.stateIndex === null
        ? []
        : findClaimPath(context.states, context.regions, found.stateIndex),
    reason: found.check.witness,
  };
};

const checkInStates = (claim: Claim, context: ClaimContext): StateCheck[] => {
  const stateIndexes = getClaimStates(claim, context);
  if (stateIndexes === null) {
    const check = checkClaim(claim, context.reachable);
    return check ? [{ stateIndex: null, check }] : [];
  }
  return stateIndexes.flatMap((stateIndex): StateCheck[] => {
    const constraints = context.constraintsByState[stateIndex];
    const check = constraints ? checkClaim(claim, constraints) : null;
    return check ? [{ stateIndex, check }] : [];
  });
};

export const evaluateClaims = (
  analysis: ComponentAnalysis,
  states: State[],
  regions: Region[],
  constraintsByState: Constraints[],
  reachable: Constraints,
): ClaimOutcome[] => {
  const context = createClaimContext(analysis, states, regions, constraintsByState, reachable);
  return [
    ...analysis.claims.map((claim) => toOutcome(claim, checkInStates(claim, context), context)),
    ...checkStateClaims(context),
  ];
};

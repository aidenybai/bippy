import {
  assumeCondition,
  evaluateCondition,
  getPossibleValues,
  hasUnknownPart,
  isBooleanExpression,
  type Constraints,
} from "./constraints";
import { getFieldCases } from "./field-cases";
import { formatAbstractValue, formatSymbolicValue } from "./format";
import type {
  AbstractValue,
  Binding,
  Claim,
  ClaimOutcome,
  ComponentAnalysis,
  Region,
  State,
  StateUpdate,
  SymbolicValue,
} from "./types";
import { canTypeEqualLiteral } from "./utils/can-type-equal-literal";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getPlaceKey } from "./utils/get-place-key";
import { getTestExpression } from "./utils/get-test-expression";
import { getValueKey } from "./utils/get-value-key";
import { getValuePlace } from "./utils/get-value-place";
import { isStateBinding } from "./utils/is-state-binding";

interface Check {
  outcome: boolean | null;
  witness: string | null;
}

interface StateCheck {
  stateIndex: number | null;
  check: Check;
}

export const describeCases = (cases: AbstractValue[]): string =>
  cases.map(formatAbstractValue).join(" | ");

const isIncluded = (value: AbstractValue, cases: AbstractValue[]): boolean =>
  cases.some((candidate) => {
    if (value.kind === "Literal")
      return candidate.kind === "Literal"
        ? candidate.value === value.value
        : canTypeEqualLiteral(candidate, value.value);
    return candidate.kind === "Type" && candidate.text === value.text;
  });

const getSubjectValues = (
  subject: SymbolicValue,
  constraints: Constraints,
): AbstractValue[] | null =>
  subject.kind === "Primitive"
    ? [{ kind: "Literal", value: subject.value }]
    : getPossibleValues(subject, constraints);

const checkMembership = (claim: Claim, cases: AbstractValue[], constraints: Constraints): Check => {
  const values = getSubjectValues(claim.subject, constraints);
  if (!values) return { outcome: null, witness: null };
  const outside = values.filter((value) => !isIncluded(value, cases));
  if (outside.length === 0) return { outcome: true, witness: null };
  const witness = `${formatSymbolicValue(claim.subject)} = ${describeCases(outside)}`;
  return { outcome: outside.length === values.length ? false : null, witness };
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
  if (outcome !== null) return { outcome, witness: null };
  const failing = assumeFalse(test, constraints);
  if (!failing) return { outcome: true, witness: null };
  return { outcome: null, witness: describeFailure(test, failing) };
};

const checkClaim = (claim: Claim, constraints: Constraints): Check | null => {
  if (claim.guards.some((guard) => evaluateCondition(guard, constraints) === false)) return null;
  if (claim.cases) return checkMembership(claim, claim.cases, constraints);
  if (claim.test) return checkCondition(claim.test, constraints);
  return { outcome: null, witness: null };
};

const collectBindingIds = (values: SymbolicValue[]): Set<number> => {
  const ids = new Set<number>();
  for (const value of values)
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") ids.add(part.binding.id);
    });
  return ids;
};

const findPath = (states: State[], regions: Region[], target: number): string[] => {
  const region = regions.find((candidate) => candidate.states.includes(target));
  const start = region?.firstRenderState ?? null;
  if (start === null) return [];
  const previous = new Map<number, [number, string]>();
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current === undefined || current === target) break;
    for (const transition of states[current]?.transitions ?? [])
      for (const next of transition.targets)
        if (next !== start && !previous.has(next)) {
          previous.set(next, [current, transition.handlerId]);
          queue.push(next);
        }
  }
  const path: string[] = [];
  for (let step = previous.get(target); step; step = previous.get(step[0])) path.unshift(step[1]);
  return path;
};

const toOutcome = (
  claim: Claim,
  checks: StateCheck[],
  states: State[],
  regions: Region[],
): ClaimOutcome => {
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
    path: found.stateIndex === null ? [] : findPath(states, regions, found.stateIndex),
    reason: found.check.witness,
  };
};

const checkInStates = (
  claim: Claim,
  states: State[],
  regions: Region[],
  constraintsByState: Constraints[],
  reachable: Constraints,
): StateCheck[] => {
  const bindingIds = collectBindingIds([claim.subject, ...claim.guards]);
  const relevant = regions.filter((region) => region.bindingIds.some((id) => bindingIds.has(id)));
  if (relevant.length === 0) {
    const check = checkClaim(claim, reachable);
    return check ? [{ stateIndex: null, check }] : [];
  }
  return relevant
    .flatMap((region) => region.states)
    .flatMap((stateIndex): StateCheck[] => {
      const constraints = constraintsByState[stateIndex];
      const check = constraints ? checkClaim(claim, constraints) : null;
      return check ? [{ stateIndex, check }] : [];
    });
};

const createStateClaim = (
  analysis: ComponentAnalysis,
  binding: Binding,
  cases: AbstractValue[],
): Claim => ({
  kind: "state",
  subject: { kind: "Binding", binding, path: [] },
  cases,
  test: null,
  guards: [],
  description: `${binding.name} stays within ${describeCases(cases)}`,
  loc: binding.loc,
  file: analysis.file,
});

const hasCastPart = (value: SymbolicValue): boolean => {
  let isCast = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Unknown" && part.reason === "cast") isCast = true;
  });
  return isCast;
};

const isPrimitiveDomain = (cases: AbstractValue[]): boolean =>
  cases.every((value) => value.kind === "Literal" || value.primitive !== null);

const isBooleanDomain = (cases: AbstractValue[]): boolean =>
  cases.every((value) => value.kind === "Literal" && typeof value.value === "boolean");

const checkUpdate = (
  binding: Binding,
  cases: AbstractValue[],
  update: StateUpdate,
): Pick<ClaimOutcome, "verdict" | "reason"> | null => {
  const fieldCases = getFieldCases(update.value, [], binding, null);
  if (fieldCases === "unchanged") return null;
  if (fieldCases) {
    const outside = fieldCases.filter((value) => !isIncluded(value, cases));
    return outside.length === 0
      ? null
      : { verdict: "broken", reason: `set to ${describeCases(outside)}` };
  }
  if (isBooleanDomain(cases) && isBooleanExpression(update.value)) return null;
  const source = update.value.kind === "Binding" ? update.value.binding.domain : null;
  if (source?.kind === "Cases" && !hasUnknownPart(update.value)) {
    const outside = source.cases.filter((value) => !isIncluded(value, cases));
    return outside.length === 0
      ? null
      : { verdict: "unproven", reason: `may be set to ${describeCases(outside)}` };
  }
  return hasCastPart(update.value) ? { verdict: "unproven", reason: "set through a cast" } : null;
};

const findHandlerState = (states: State[], handlerId: string): number | null => {
  const stateIndex = states.findIndex((state) =>
    state.transitions.some((transition) => transition.handlerId === handlerId),
  );
  return stateIndex === -1 ? null : stateIndex;
};

const checkStateClaim = (
  analysis: ComponentAnalysis,
  binding: Binding,
  cases: AbstractValue[],
  states: State[],
  regions: Region[],
): ClaimOutcome => {
  const claim = createStateClaim(analysis, binding, cases);
  for (const handler of analysis.handlers)
    for (const update of handler.updates) {
      if (update.binding.id !== binding.id) continue;
      const problem = checkUpdate(binding, cases, update);
      if (!problem) continue;
      const stateIndex = findHandlerState(states, handler.id);
      const path = stateIndex === null ? [] : findPath(states, regions, stateIndex);
      return { claim, ...problem, stateIndex, path };
    }
  return { claim, verdict: "holds", stateIndex: null, path: [], reason: null };
};

export const evaluateClaims = (
  analysis: ComponentAnalysis,
  states: State[],
  regions: Region[],
  constraintsByState: Constraints[],
  reachable: Constraints,
): ClaimOutcome[] => [
  ...analysis.claims.map((claim) =>
    toOutcome(
      claim,
      checkInStates(claim, states, regions, constraintsByState, reachable),
      states,
      regions,
    ),
  ),
  ...analysis.bindings.flatMap((binding): ClaimOutcome[] =>
    isStateBinding(binding) &&
    binding.domain.kind === "Cases" &&
    isPrimitiveDomain(binding.domain.cases)
      ? [checkStateClaim(analysis, binding, binding.domain.cases, states, regions)]
      : [],
  ),
];

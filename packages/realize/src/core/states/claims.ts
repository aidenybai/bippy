import { isEffectHandler } from "../handlers/handler-predicates";
import {
  assumeCondition,
  assumeGuards,
  evaluateCondition,
  getRelevantConstraintsKey,
  getValueCases,
  type Constraints,
} from "../solver/constraints";
import {
  classify,
  describeCases,
  isBooleanDomain,
  isPrimitiveDomain,
  withNullishCases,
} from "../type-checker/domains";
import { formatSymbolicValue } from "../values/format";
import type {
  AbstractValue,
  Binding,
  Claim,
  ClaimOutcome,
  ComponentAnalysis,
  Handler,
  Region,
  State,
  StateUpdate,
  SymbolicValue,
} from "../types";
import { createBindingInputsAdder } from "./binding-inputs";
import { findStatePath } from "./find-state-path";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getPlaceKey } from "../values/get-place-key";
import { getTestExpression } from "../values/get-test-expression";
import { getValueKey } from "../values/get-value-key";
import { getValuePlace } from "../values/get-value-place";
import { isBooleanExpression } from "../values/is-boolean-expression";
import { isStateBinding } from "../values/is-state-binding";
import { hasCastPart } from "../values/has-cast-part";

interface ClaimContext {
  analysis: ComponentAnalysis;
  states: State[];
  regions: Region[];
  constraintsByState: Constraints[];
  reachable: Constraints;
  renderedHandlerIds: Set<string>[];
  addBindingInputs: (bindingIds: Set<number>) => void;
}

interface Check {
  outcome: boolean | null;
  witness: string | null;
}

interface StateCheck {
  stateIndex: number | null;
  check: Check;
}

const collectBindingIds = (values: SymbolicValue[]): Set<number> => {
  const ids = new Set<number>();
  for (const value of values)
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") ids.add(part.binding.id);
    });
  return ids;
};

const getOpaqueInputBindingIds = (value: SymbolicValue): number[] => {
  const bindingIds: number[] = [];
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding")
      bindingIds.push(...part.binding.inputPlaces.map((place) => place.bindingId));
  });
  return bindingIds;
};

const hasOpaqueGuardOn = (subject: SymbolicValue, guards: SymbolicValue[]): boolean => {
  const subjectBindingIds = collectBindingIds([subject]);
  return guards.some((guard) =>
    getOpaqueInputBindingIds(guard).some((bindingId) => subjectBindingIds.has(bindingId)),
  );
};

const checkMembership = (claim: Claim, cases: AbstractValue[], constraints: Constraints): Check => {
  const values = getValueCases(claim.subject, constraints);
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

const checkNarrowedClaim = (claim: Claim, narrowed: Constraints): Check => {
  return claim.check.kind === "Membership"
    ? checkMembership(claim, claim.check.cases, narrowed)
    : checkCondition(claim.check.test, narrowed);
};

const checkClaim = (claim: Claim, constraints: Constraints): Check | null => {
  const narrowed = assumeGuards(claim.guards, constraints);
  if (!narrowed) return null;
  const check = checkNarrowedClaim(claim, narrowed);
  return check.outcome === false && hasOpaqueGuardOn(claim.subject, claim.guards)
    ? { ...check, outcome: null }
    : check;
};

const isAvailable = (handlerId: string, renderedIds: Set<string>, context: ClaimContext): boolean =>
  renderedIds.has(handlerId) ||
  context.analysis.handlers.some(
    (handler) =>
      handler.delegates.includes(handlerId) &&
      (isEffectHandler(handler) || renderedIds.has(handler.id)),
  );

const getHandlerStates = (handler: Handler, context: ClaimContext): number[] | null =>
  isEffectHandler(handler)
    ? null
    : context.renderedHandlerIds.flatMap((renderedIds, index) =>
        isAvailable(handler.id, renderedIds, context) ? [index] : [],
      );

const isUnplaced = (handler: Handler | null): boolean =>
  handler?.trigger.kind === "Effect" && handler.trigger.hookKind === "Custom";

const getClaimStates = (
  claim: Claim,
  handler: Handler | null,
  context: ClaimContext,
): number[] | null => {
  if (isUnplaced(handler)) return null;
  const handlerStates = handler ? getHandlerStates(handler, context) : null;
  const bindingIds = collectBindingIds([claim.subject, ...claim.guards]);
  const relevant = context.regions.filter((region) =>
    region.bindingIds.some((id) => bindingIds.has(id)),
  );
  if (relevant.length === 0) return handlerStates;
  const regionStates = relevant.flatMap((region) => region.states);
  if (!handlerStates) return regionStates;
  const available = new Set(handlerStates);
  return regionStates.filter((index) => available.has(index));
};

const checkInStates = (
  stateIndexes: number[] | null,
  context: ClaimContext,
  check: (constraints: Constraints) => Check | null,
  readValues: SymbolicValue[] | null = null,
): StateCheck[] => {
  if (stateIndexes === null) {
    const reachableCheck = check(context.reachable);
    return reachableCheck ? [{ stateIndex: null, check: reachableCheck }] : [];
  }
  const bindingIds = readValues && collectBindingIds(readValues);
  const checksByKey = new Map<string, Check | null>();
  const checkOnce = (constraints: Constraints): Check | null => {
    if (!bindingIds) return check(constraints);
    const constraintsKey = getRelevantConstraintsKey(
      constraints,
      bindingIds,
      context.addBindingInputs,
    );
    if (checksByKey.has(constraintsKey)) return checksByKey.get(constraintsKey) ?? null;
    const stateCheck = check(constraints);
    checksByKey.set(constraintsKey, stateCheck);
    return stateCheck;
  };
  return stateIndexes.flatMap((stateIndex): StateCheck[] => {
    const constraints = context.constraintsByState[stateIndex];
    const stateCheck = constraints ? checkOnce(constraints) : null;
    return stateCheck ? [{ stateIndex, check: stateCheck }] : [];
  });
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
        : findStatePath(context.states, context.regions, found.stateIndex),
    reason: found.check.witness ?? (broken ? null : "can't be decided"),
  };
};

const evaluateClaim = (
  claim: Claim,
  handler: Handler | null,
  context: ClaimContext,
): ClaimOutcome =>
  toOutcome(
    claim,
    checkInStates(
      getClaimStates(claim, handler, context),
      context,
      (constraints) => checkClaim(claim, constraints),
      [
        claim.subject,
        ...claim.guards,
        ...(claim.check.kind === "Condition" ? [claim.check.test] : []),
      ],
    ),
    context,
  );

const isLiteralValue = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" ||
  (value.kind === "Conditional" &&
    isLiteralValue(value.consequent) &&
    isLiteralValue(value.alternate));

const STAYS_WITHIN: Check = { outcome: true, witness: null };

const isWithinCases = (
  cases: AbstractValue[],
  value: SymbolicValue,
  constraints: Constraints,
): boolean => {
  if (isBooleanDomain(cases) && isBooleanExpression(value)) return true;
  const values = getValueCases(value, constraints);
  return values !== null && values.every((candidate) => classify(candidate, cases) === "in");
};

const checkUpdate = (
  cases: AbstractValue[],
  update: StateUpdate,
  constraints: Constraints,
): Check | null => {
  if (isWithinCases(cases, update.value, constraints)) return STAYS_WITHIN;
  const narrowed = assumeGuards(update.guards, constraints);
  if (!narrowed) return null;
  const values = getValueCases(update.value, narrowed);
  if (!values)
    return hasCastPart(update.value)
      ? { outcome: null, witness: "set through a cast" }
      : STAYS_WITHIN;
  const outside = values.filter((value) => classify(value, cases) !== "in");
  if (outside.length === 0) return STAYS_WITHIN;
  return isLiteralValue(update.value)
    ? { outcome: false, witness: `set to ${describeCases(outside)}` }
    : { outcome: null, witness: `may be set to ${describeCases(outside)}` };
};

const createStateClaim = (binding: Binding, cases: AbstractValue[]): Claim => ({
  kind: "state",
  subject: { kind: "Binding", binding, path: [] },
  check: { kind: "Membership", cases },
  guards: [],
  description: `${binding.name} stays within ${describeCases(cases)}`,
  loc: binding.loc,
});

const checkStateClaim = (
  binding: Binding,
  cases: AbstractValue[],
  context: ClaimContext,
): ClaimOutcome => {
  const checks = context.analysis.handlers.flatMap((handler) =>
    handler.updates
      .filter((update) => update.binding.id === binding.id)
      .flatMap((update) =>
        checkInStates(
          getHandlerStates(handler, context),
          context,
          (constraints) => checkUpdate(cases, update, constraints),
          [{ kind: "Binding", binding, path: [] }, update.value, ...update.guards],
        ),
      ),
  );
  const outcome = toOutcome(createStateClaim(binding, cases), checks, context);
  return outcome.reason === "never reached" ? { ...outcome, reason: null } : outcome;
};

const getStateClaimCases = (binding: Binding, context: ClaimContext): AbstractValue[] | null => {
  if (!isStateBinding(binding) || binding.domain.kind !== "Cases") return null;
  if (!isPrimitiveDomain(binding.domain.cases)) return null;
  return context.analysis.isStrictNullChecks
    ? binding.domain.cases
    : withNullishCases(binding.domain.cases);
};

export const evaluateClaims = (
  analysis: ComponentAnalysis,
  states: State[],
  regions: Region[],
  constraintsByState: Constraints[],
  reachable: Constraints,
  renderedHandlerIds: Set<string>[],
): ClaimOutcome[] => {
  const context: ClaimContext = {
    analysis,
    states,
    regions,
    constraintsByState,
    reachable,
    renderedHandlerIds,
    addBindingInputs: createBindingInputsAdder(analysis.bindings),
  };
  return [
    ...analysis.claims.map((claim) => evaluateClaim(claim, null, context)),
    ...analysis.handlers.flatMap((handler) =>
      handler.claims.map((claim) => evaluateClaim(claim, handler, context)),
    ),
    ...analysis.bindings.flatMap((binding): ClaimOutcome[] => {
      const cases = getStateClaimCases(binding, context);
      return cases ? [checkStateClaim(binding, cases, context)] : [];
    }),
  ];
};

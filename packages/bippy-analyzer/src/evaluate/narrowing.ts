// Equality and logical narrowing adapted from TypeScript. See ../../third-party-notices.md.
import type { BinaryExpression, CallExpression, Expression } from "oxc-parser";
import type { Scope, StaticObjectEntry, StaticObjectValue, StaticValue } from "../types.js";
import { hasNamedProperty } from "./has-property.js";
import {
  getAlternativeGuards,
  guardedPredicate,
  recordDerivation,
  recordRefinement,
} from "./predicates.js";
import { findOwningScope, lookupScope } from "./scope.js";
import { getTypePredicate } from "./type-predicates.js";
import {
  UNDEFINED_VALUE,
  branchValue,
  compareIdentity,
  describeValue,
  getTruthiness,
  getOwnPropertyEntry,
  isNullish,
  primitiveValue,
  unknownPrimitiveValue,
} from "./values.js";

/** What a test narrows: a binding (`x`) or a plain property read off one (`ref.current`). */
export interface NarrowingTarget {
  name: string;
  key: string | null;
}

/** The values a target can hold on the path where a test held or failed; `null` marks an infeasible path. */
export interface TestNarrowing {
  target: NarrowingTarget;
  whenTrue: StaticValue | null;
  whenFalse: StaticValue | null;
}

interface Predicate {
  (value: StaticValue): boolean | null;
}

/** What an alternative the predicate cannot decide becomes on the passing side. */
interface Refinement {
  (value: StaticValue): StaticValue;
}

interface NarrowingLookup {
  (target: NarrowingTarget): StaticValue | undefined;
}

/** `typeof value` as the interpreter evaluates it for the current rendering environment. */
interface TypeofEvaluator {
  (value: StaticValue): StaticValue;
}

const getNarrowingTarget = (node: Expression): NarrowingTarget | null => {
  if (node.type === "Identifier") return { name: node.name, key: null };
  if (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    node.property.type === "Identifier"
  ) {
    return { name: node.object.name, key: node.property.name };
  }
  return null;
};

/**
 * The targets a `switch` discriminant reads, so each case path sees only the
 * alternatives its label can match: `x`, `ctx.next`, or both sides of
 * `ctx.prev = ctx.next`, which compiled generators use to dispatch resumptions.
 */
export const getDiscriminantTargets = (node: Expression): NarrowingTarget[] => {
  if (node.type === "ParenthesizedExpression") return getDiscriminantTargets(node.expression);
  if (node.type === "AssignmentExpression" && node.operator === "=") {
    const left =
      node.left.type === "Identifier" || node.left.type === "MemberExpression"
        ? getNarrowingTarget(node.left)
        : null;
    return [left, getNarrowingTarget(node.right)].filter(
      (target): target is NarrowingTarget => target !== null,
    );
  }
  const target = getNarrowingTarget(node);
  return target ? [target] : [];
};

const describeTarget = (target: NarrowingTarget): string =>
  target.key === null ? target.name : `${target.name}.${target.key}`;

const isSameTarget = (left: NarrowingTarget, right: NarrowingTarget): boolean =>
  left.name === right.name && left.key === right.key;

/** Resolves a test's callee without side effects; `null` when it is not a plain identifier or member path. */
interface CalleeResolver {
  (callee: Expression): StaticValue | null;
}

interface TestNarrower {
  (lookup: NarrowingLookup): TestNarrowing | null;
}

const alternativesOf = (value: StaticValue): StaticValue[] =>
  value.kind === "branch" ? value.alternatives : [value];

interface NarrowedAlternative {
  value: StaticValue;
  index: number;
}

const partition = (
  value: StaticValue,
  predicate: Predicate,
  reason: string,
  refine: Refinement | null,
  refineFalse: Refinement | null = null,
): [StaticValue | null, StaticValue | null] => {
  const passing: NarrowedAlternative[] = [];
  const failing: NarrowedAlternative[] = [];
  const resolved = value.kind === "branch" ? getAlternativeGuards(value) : null;
  for (const [index, alternative] of alternativesOf(value).entries()) {
    const verdict = predicate(alternative);
    if (verdict === null)
      passing.push({ value: refine ? refine(alternative) : alternative, index });
    else if (verdict) passing.push({ value: alternative, index });
    if (verdict !== true)
      failing.push({
        value: verdict === null && refineFalse ? refineFalse(alternative) : alternative,
        index,
      });
  }
  const rebuild = (alternatives: NarrowedAlternative[]): StaticValue | null => {
    if (alternatives.length === 0) return null;
    const rebuilt = branchValue(
      alternatives.map((alternative) => alternative.value),
      reason,
      value.kind === "branch" ? value.location : null,
      value.kind === "branch"
        ? Math.max(
            0,
            alternatives.findIndex((alternative) => alternative.index === value.preferredIndex),
          )
        : 0,
      resolved
        ? guardedPredicate(
            alternatives.map((alternative) => resolved.guards[alternative.index]),
            [resolved.inputs],
          )
        : null,
    );
    recordRefinement(rebuilt, value);
    return rebuilt;
  };
  return [rebuild(passing), rebuild(failing)];
};

const getNullishLiteral = (node: Expression): null | undefined | false => {
  if (node.type === "Literal" && node.value === null) return null;
  if (node.type === "Identifier" && node.name === "undefined") return undefined;
  if (node.type === "UnaryExpression" && node.operator === "void") return undefined;
  return false;
};

/** `x === null` / `x === undefined`: strict equality tells the two apart, loose equality does not. */
const isExactly =
  (literal: null | undefined): Predicate =>
  (value) =>
    value.kind === "primitive"
      ? value.value === literal
      : isNullish(value) === false
        ? false
        : null;

const narrowTarget = (
  target: NarrowingTarget | null,
  lookup: NarrowingLookup,
  predicate: Predicate,
  describeReason: (targetName: string) => string,
  refine: Refinement | null = null,
  refineFalse: Refinement | null = null,
): TestNarrowing | null => {
  const value = target && lookup(target);
  if (!target || !value || (value.kind !== "branch" && !refine)) return null;
  const [whenTrue, whenFalse] = partition(
    value,
    predicate,
    describeReason(describeTarget(target)),
    refine,
    refineFalse,
  );
  return { target, whenTrue, whenFalse };
};

const getTypeofTest = (
  test: BinaryExpression,
): { operand: Expression; typeName: string } | null => {
  const [unary, literal] =
    test.left.type === "UnaryExpression" ? [test.left, test.right] : [test.right, test.left];
  if (unary.type !== "UnaryExpression" || unary.operator !== "typeof") return null;
  if (literal.type !== "Literal" || typeof literal.value !== "string") return null;
  return { operand: unary.argument, typeName: literal.value };
};

/** An undecided alternative that passes `typeof x === "string"` is some string; only opaque values are replaced. */
const refineByTypeof = (typeName: string): Refinement | null => {
  const refined = (alternative: StaticValue): StaticValue | null => {
    if (alternative.kind !== "unknown" && alternative.kind !== "unknown-primitive") return null;
    if (typeName === "undefined") return UNDEFINED_VALUE;
    if (typeName === "string" || typeName === "number" || typeName === "boolean") {
      return recordDerivation(
        unknownPrimitiveValue(
          typeName,
          `${describeValue(alternative)} where typeof is "${typeName}"`,
        ),
        { kind: "alias", operand: alternative },
      );
    }
    return null;
  };
  return (alternative) => refined(alternative) ?? alternative;
};

/** `typeof x === "string"`: alternatives whose `typeof` is known are kept or dropped; opaque ones are refined. */
const narrowTypeof = (
  test: BinaryExpression,
  lookup: NarrowingLookup,
  getTypeof: TypeofEvaluator,
): TestNarrowing | null => {
  const typeofTest = getTypeofTest(test);
  if (!typeofTest) return null;
  const { operand, typeName } = typeofTest;
  return narrowTarget(
    getNarrowingTarget(operand),
    lookup,
    (value) => {
      const evaluated = getTypeof(value);
      return evaluated.kind === "primitive" ? evaluated.value === typeName : null;
    },
    (targetName) => `typeof ${targetName} is "${typeName}"`,
    refineByTypeof(typeName),
  );
};

const narrowLiteralEquality = (
  test: BinaryExpression,
  lookup: NarrowingLookup,
): TestNarrowing | null => {
  if (test.operator !== "===" && test.operator !== "!==") return null;
  const [operand, literalNode] =
    test.left.type === "Literal" ? [test.right, test.left] : [test.left, test.right];
  if (operand.type !== "Identifier" || literalNode.type !== "Literal" || "regex" in literalNode)
    return null;
  const literal = primitiveValue(literalNode.value);
  return narrowTarget(
    getNarrowingTarget(operand),
    lookup,
    (value) => compareIdentity(value, literal),
    (targetName) => `${targetName} equals ${describeValue(literal)}`,
    (alternative) => (literal.value === 0 ? alternative : literal),
    (alternative) =>
      alternative.kind === "unknown-primitive" &&
      alternative.primitiveType === "boolean" &&
      typeof literal.value === "boolean"
        ? primitiveValue(!literal.value)
        : alternative,
  );
};

const negate = (narrowing: TestNarrowing | null): TestNarrowing | null =>
  narrowing && {
    target: narrowing.target,
    whenTrue: narrowing.whenFalse,
    whenFalse: narrowing.whenTrue,
  };

const isReadOnlyTest = (test: Expression): boolean => {
  switch (test.type) {
    case "Identifier":
    case "Literal":
      return true;
    case "ParenthesizedExpression":
      return isReadOnlyTest(test.expression);
    case "UnaryExpression":
      return (
        (test.operator === "!" || test.operator === "typeof" || test.operator === "void") &&
        isReadOnlyTest(test.argument)
      );
    case "BinaryExpression":
      return (
        (test.operator === "===" || test.operator === "!==") &&
        isReadOnlyTest(test.left) &&
        isReadOnlyTest(test.right)
      );
    case "LogicalExpression":
      return isReadOnlyTest(test.left) && isReadOnlyTest(test.right);
    default:
      return false;
  }
};

const narrowLogical = (
  operator: "||" | "&&",
  left: TestNarrowing | null,
  narrowRight: TestNarrower,
  lookup: NarrowingLookup,
): TestNarrowing | null => {
  const primary = left ?? narrowRight(lookup);
  if (!primary) return null;
  const original = lookup(primary.target);
  if (!original) return null;
  const isOr = operator === "||";
  const sideOf = (narrowing: TestNarrowing): StaticValue | null =>
    isOr ? narrowing.whenFalse : narrowing.whenTrue;
  let combined = sideOf(primary);
  if (left && combined !== null) {
    const narrowedLookup: NarrowingLookup = (target) =>
      isSameTarget(target, left.target) ? (sideOf(left) ?? undefined) : lookup(target);
    const right = narrowRight(narrowedLookup);
    if (right && isSameTarget(left.target, right.target)) combined = sideOf(right);
  }
  if (combined) recordRefinement(combined, original);
  return isOr
    ? { target: primary.target, whenTrue: original, whenFalse: combined }
    : { target: primary.target, whenTrue: combined, whenFalse: original };
};

/** `isValidElement(x)` / `Array.isArray(x)`: the callee's type test partitions a branch-valued `x`. */
const narrowTypePredicateCall = (
  test: CallExpression,
  lookup: NarrowingLookup,
  resolveCallee: CalleeResolver,
): TestNarrowing | null => {
  const [argument] = test.arguments;
  if (test.arguments.length !== 1 || !argument) return null;
  const target = argument.type === "SpreadElement" ? null : getNarrowingTarget(argument);
  if (!target || lookup(target)?.kind !== "branch") return null;
  const callee = resolveCallee(test.callee);
  const predicate = callee && getTypePredicate(callee);
  if (!predicate) return null;
  return narrowTarget(
    target,
    lookup,
    predicate.test,
    (targetName) => `${predicate.name}(${targetName})`,
  );
};

/**
 * Derives what a branch-valued identifier or `identifier.property` path must be on
 * each side of a test. Handles `x`, `!x`, `"key" in x`, `x == null` / `x === undefined`
 * (and their negations), `isValidElement(x)` / `Array.isArray(x)` and `||` / `&&` of
 * those, mirroring the narrowing TypeScript applies to the same expressions.
 */
export const narrowTest = (
  test: Expression,
  lookup: NarrowingLookup,
  resolveCallee: CalleeResolver,
  getTypeof: TypeofEvaluator,
): TestNarrowing | null => {
  switch (test.type) {
    case "Identifier":
    case "MemberExpression":
      return narrowTarget(
        getNarrowingTarget(test),
        lookup,
        getTruthiness,
        (targetName) => `${targetName} is truthy`,
      );
    case "UnaryExpression":
      return test.operator === "!"
        ? negate(narrowTest(test.argument, lookup, resolveCallee, getTypeof))
        : null;
    case "ParenthesizedExpression":
      return narrowTest(test.expression, lookup, resolveCallee, getTypeof);
    case "CallExpression":
      return narrowTypePredicateCall(test, lookup, resolveCallee);
    case "LogicalExpression":
      return test.operator === "??" || !isReadOnlyTest(test)
        ? null
        : narrowLogical(
            test.operator,
            narrowTest(test.left, lookup, resolveCallee, getTypeof),
            (narrowedLookup) => narrowTest(test.right, narrowedLookup, resolveCallee, getTypeof),
            lookup,
          );
    case "BinaryExpression": {
      if (test.operator === "in") {
        if (test.left.type !== "Literal") return null;
        const key = String(test.left.value);
        return narrowTarget(
          getNarrowingTarget(test.right),
          lookup,
          (value) => {
            const presence = hasNamedProperty(key, value);
            return presence === null ? null : getTruthiness(presence);
          },
          (targetName) => `"${key}" in ${targetName}`,
        );
      }
      const isEquality = test.operator === "==" || test.operator === "===";
      const isInequality = test.operator === "!=" || test.operator === "!==";
      if (!isEquality && !isInequality) return null;
      const narrowingByValue =
        narrowTypeof(test, lookup, getTypeof) ?? narrowLiteralEquality(test, lookup);
      if (narrowingByValue) return isEquality ? narrowingByValue : negate(narrowingByValue);
      const [operand, literalNode] =
        getNullishLiteral(test.right) === false ? [test.right, test.left] : [test.left, test.right];
      const literal = getNullishLiteral(literalNode);
      if (literal === false) return null;
      const isStrict = test.operator === "===" || test.operator === "!==";
      const narrowing = narrowTarget(
        getNarrowingTarget(operand),
        lookup,
        isStrict ? isExactly(literal) : isNullish,
        (targetName) => `${targetName} is ${isStrict ? String(literal) : "nullish"}`,
      );
      return isEquality ? narrowing : negate(narrowing);
    }
    default:
      return null;
  }
};

/** Records that `object` is about to change so an enclosing fork can undo it for its other paths. */
interface HeapJournalEntry {
  (object: StaticObjectValue): void;
}

/** Looks a target up without evaluating: a binding, or a plain data property of an object-valued binding. */
export const lookupNarrowingTarget = (
  scope: Scope,
  target: NarrowingTarget,
  getProperty: (object: StaticObjectValue, key: string) => StaticValue,
): StaticValue | undefined => {
  const bound = lookupScope(scope, target.name);
  if (target.key === null || bound === undefined) return bound;
  if (bound.kind !== "object") return undefined;
  const entry = getOwnPropertyEntry(bound, target.key);
  return !entry || entry.accessor ? undefined : getProperty(bound, target.key);
};

const narrowProperty = (
  scope: Scope,
  target: NarrowingTarget,
  key: string,
  value: StaticValue,
  journal: HeapJournalEntry,
): { object: StaticObjectValue; entry: StaticObjectEntry } | null => {
  const object = lookupScope(scope, target.name);
  if (object?.kind !== "object") return null;
  const previous = getOwnPropertyEntry(object, key);
  if (!previous || previous.accessor) return null;
  const entry: StaticObjectEntry = { ...previous, value };
  journal(object);
  object.entries.push(entry);
  return { object, entry };
};

/** Narrows `target` for the duration of `run`, then restores it. */
export const withNarrowedTarget = <Result>(
  scope: Scope,
  target: NarrowingTarget,
  value: StaticValue,
  journal: HeapJournalEntry,
  run: () => Result,
): Result => {
  if (target.key !== null) {
    const narrowed = narrowProperty(scope, target, target.key, value, journal);
    if (!narrowed) return run();
    try {
      return run();
    } finally {
      const index = narrowed.object.entries.lastIndexOf(narrowed.entry);
      if (index !== -1) narrowed.object.entries.splice(index, 1);
    }
  }
  const owner = findOwningScope(scope, target.name);
  if (!owner?.parent) return run();
  const previous = owner.bindings.get(target.name);
  owner.bindings.set(target.name, value);
  try {
    return run();
  } finally {
    if (previous && owner.bindings.get(target.name) === value) {
      owner.bindings.set(target.name, previous);
    }
  }
};

/** Narrows `target` with no restore; the caller's fork snapshot undoes it. */
export const applyNarrowing = (
  scope: Scope,
  target: NarrowingTarget,
  value: StaticValue,
  journal: HeapJournalEntry,
): void => {
  if (target.key !== null) {
    narrowProperty(scope, target, target.key, value, journal);
    return;
  }
  const owner = findOwningScope(scope, target.name);
  if (owner?.parent) owner.bindings.set(target.name, value);
};

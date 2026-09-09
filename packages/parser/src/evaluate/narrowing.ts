import type { BinaryExpression, CallExpression, Expression } from "oxc-parser";
import type { Scope, StaticObjectEntry, StaticObjectValue, StaticValue } from "../types.js";
import { hasNamedProperty } from "./has-property.js";
import { recordRefinement } from "./predicates.js";
import { findOwningScope, lookupScope } from "./scope.js";
import { getThrowCertainty } from "./thrown.js";
import { getTypePredicate } from "./type-predicates.js";
import {
  UNDEFINED_VALUE,
  branchValue,
  describeValue,
  getTruthiness,
  isNullish,
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

export interface NarrowingLookup {
  (target: NarrowingTarget): StaticValue | undefined;
}

/** `typeof value` as the interpreter evaluates it for the current rendering environment. */
export interface TypeofEvaluator {
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

const describeTarget = (target: NarrowingTarget): string =>
  target.key === null ? target.name : `${target.name}.${target.key}`;

const isSameTarget = (left: NarrowingTarget, right: NarrowingTarget): boolean =>
  left.name === right.name && left.key === right.key;

/** Resolves a test's callee without side effects; `null` when it is not a plain identifier or member path. */
export interface CalleeResolver {
  (callee: Expression): StaticValue | null;
}

/** Evaluates a test expression with `name` bound to `alternative`. */
export interface TestEvaluator {
  (name: string, alternative: StaticValue): StaticValue;
}

interface PureTestShape {
  identifiers: Set<string>;
  calledRoots: Set<string>;
}

const MAX_EVALUATED_ALTERNATIVES = 8;

const alternativesOf = (value: StaticValue): StaticValue[] =>
  value.kind === "branch" ? value.alternatives : [value];

const partition = (
  value: StaticValue,
  predicate: Predicate,
  reason: string,
  refine: Refinement | null,
): [StaticValue | null, StaticValue | null] => {
  const passing: StaticValue[] = [];
  const failing: StaticValue[] = [];
  for (const alternative of alternativesOf(value)) {
    const verdict = predicate(alternative);
    if (verdict === null) passing.push(refine ? refine(alternative) : alternative);
    else if (verdict) passing.push(alternative);
    if (verdict !== true) failing.push(alternative);
  }
  const rebuild = (alternatives: StaticValue[]): StaticValue | null => {
    if (alternatives.length === 0) return null;
    const rebuilt = branchValue(alternatives, reason);
    recordRefinement(rebuilt, value);
    return rebuilt;
  };
  return [rebuild(passing), rebuild(failing)];
};

const getNullishLiteral = (node: Expression): null | undefined | false => {
  if (node.type === "Literal" && node.value === null) return null;
  if (node.type === "Identifier" && node.name === "undefined") return undefined;
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
): TestNarrowing | null => {
  const value = target && lookup(target);
  if (!target || !value || (value.kind !== "branch" && !refine)) return null;
  const [whenTrue, whenFalse] = partition(
    value,
    predicate,
    describeReason(describeTarget(target)),
    refine,
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
      return unknownPrimitiveValue(
        typeName,
        `${describeValue(alternative)} where typeof is "${typeName}"`,
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

const negate = (narrowing: TestNarrowing | null): TestNarrowing | null =>
  narrowing && {
    target: narrowing.target,
    whenTrue: narrowing.whenFalse,
    whenFalse: narrowing.whenTrue,
  };

const intersect = (
  left: StaticValue | null,
  right: StaticValue | null,
  reason: string,
): StaticValue | null => {
  if (left === null || right === null) return null;
  const rightAlternatives = alternativesOf(right);
  const shared = alternativesOf(left).filter((alternative) =>
    rightAlternatives.includes(alternative),
  );
  return shared.length === 0 ? null : branchValue(shared, reason);
};

/**
 * `a || b` fails only when both operands fail and `a && b` holds only when both
 * hold, so that side combines the operands' narrowings; the other side keeps
 * the binding as it was.
 */
const narrowLogical = (
  operator: "||" | "&&",
  left: TestNarrowing | null,
  right: TestNarrowing | null,
  lookup: NarrowingLookup,
): TestNarrowing | null => {
  const primary = left ?? right;
  if (!primary) return null;
  const original = lookup(primary.target);
  if (!original) return null;
  const isOr = operator === "||";
  const sideOf = (narrowing: TestNarrowing): StaticValue | null =>
    isOr ? narrowing.whenFalse : narrowing.whenTrue;
  const combined =
    left && right && isSameTarget(left.target, right.target)
      ? intersect(
          sideOf(left),
          sideOf(right),
          `${describeTarget(primary.target)} narrowed by ${operator}`,
        )
      : sideOf(primary);
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
      return test.operator === "??"
        ? null
        : narrowLogical(
            test.operator,
            narrowTest(test.left, lookup, resolveCallee, getTypeof),
            narrowTest(test.right, lookup, resolveCallee, getTypeof),
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
      const typeofNarrowing = narrowTypeof(test, lookup, getTypeof);
      if (typeofNarrowing) return isEquality ? typeofNarrowing : negate(typeofNarrowing);
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

const getMemberRoot = (node: Expression): string | null =>
  node.type === "Identifier"
    ? node.name
    : node.type === "MemberExpression"
      ? getMemberRoot(node.object)
      : null;

/**
 * Collects the identifiers a test reads when it is built only from operators,
 * property reads and method calls on one of those identifiers, so evaluating
 * it again cannot run code the analysis has not already accounted for.
 */
const collectPureTestShape = (node: Expression, shape: PureTestShape): boolean => {
  switch (node.type) {
    case "Identifier":
      shape.identifiers.add(node.name);
      return true;
    case "Literal":
      return true;
    case "TemplateLiteral":
      return node.expressions.every((expression) => collectPureTestShape(expression, shape));
    case "ParenthesizedExpression":
    case "ChainExpression":
      return collectPureTestShape(node.expression, shape);
    case "MemberExpression":
      return (
        collectPureTestShape(node.object, shape) &&
        (!node.computed || collectPureTestShape(node.property, shape))
      );
    case "UnaryExpression":
      return node.operator !== "delete" && collectPureTestShape(node.argument, shape);
    case "BinaryExpression":
      return (
        node.left.type !== "PrivateIdentifier" &&
        collectPureTestShape(node.left, shape) &&
        collectPureTestShape(node.right, shape)
      );
    case "LogicalExpression":
      return collectPureTestShape(node.left, shape) && collectPureTestShape(node.right, shape);
    case "ConditionalExpression":
      return (
        collectPureTestShape(node.test, shape) &&
        collectPureTestShape(node.consequent, shape) &&
        collectPureTestShape(node.alternate, shape)
      );
    case "CallExpression": {
      if (node.callee.type !== "MemberExpression") return false;
      const root = getMemberRoot(node.callee.object);
      if (root === null) return false;
      shape.calledRoots.add(root);
      return (
        collectPureTestShape(node.callee, shape) &&
        node.arguments.every(
          (argument) => argument.type !== "SpreadElement" && collectPureTestShape(argument, shape),
        )
      );
    }
    default:
      return false;
  }
};

const isPrimitiveLike = (value: StaticValue): boolean =>
  value.kind === "primitive" || value.kind === "unknown-primitive";

/**
 * Narrows a test the syntactic rules do not cover (`x === "a"`,
 * `x.charAt(0) === "#"`, `x.kind === "leaf"`) by evaluating it once per
 * alternative of the single branch-valued identifier it reads. Method calls
 * are only re-run on primitive alternatives, where they are builtins.
 */
export const narrowTestByEvaluation = (
  test: Expression,
  lookup: NarrowingLookup,
  evaluate: TestEvaluator,
): TestNarrowing | null => {
  const shape: PureTestShape = { identifiers: new Set(), calledRoots: new Set() };
  if (!collectPureTestShape(test, shape)) return null;
  const lookupName = (name: string) => lookup({ name, key: null });
  const branched = [...shape.identifiers].filter((name) => lookupName(name)?.kind === "branch");
  if (branched.length !== 1) return null;
  const [name] = branched;
  const value = lookupName(name);
  if (!value || value.kind !== "branch") return null;
  if (value.alternatives.length > MAX_EVALUATED_ALTERNATIVES) return null;
  if ([...shape.calledRoots].some((root) => root !== name)) return null;
  if (shape.calledRoots.has(name) && !value.alternatives.every(isPrimitiveLike)) return null;
  const verdicts = new Map<StaticValue, boolean | null>();
  for (const alternative of value.alternatives) {
    const result = evaluate(name, alternative);
    verdicts.set(alternative, getThrowCertainty(result) === "never" ? getTruthiness(result) : null);
  }
  if ([...verdicts.values()].every((verdict) => verdict === null)) return null;
  const [whenTrue, whenFalse] = partition(
    value,
    (alternative) => verdicts.get(alternative) ?? null,
    `${name} narrowed by test`,
    null,
  );
  return { target: { name, key: null }, whenTrue, whenFalse };
};

/** Records that `object` is about to change so an enclosing fork can undo it for its other paths. */
export interface HeapJournalEntry {
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
  if (bound.kind !== "object" || bound.isFrozen) return undefined;
  const hasAccessor = bound.entries.some(
    (entry) => entry.kind === "property" && entry.key === target.key && entry.accessor,
  );
  return hasAccessor ? undefined : getProperty(bound, target.key);
};

const narrowProperty = (
  scope: Scope,
  target: NarrowingTarget,
  key: string,
  value: StaticValue,
  journal: HeapJournalEntry,
): { object: StaticObjectValue; entry: StaticObjectEntry } | null => {
  const object = lookupScope(scope, target.name);
  if (object?.kind !== "object" || object.isFrozen) return null;
  const entry: StaticObjectEntry = { kind: "property", key, value };
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

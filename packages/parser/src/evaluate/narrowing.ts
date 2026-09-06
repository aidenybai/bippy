import type { Expression } from "oxc-parser";
import type { Scope, StaticValue } from "../types.js";
import { findOwningScope } from "./scope.js";
import { branchValue, getTruthiness, isNullish } from "./values.js";

/** The values a binding can hold on the path where a test held or failed; `null` marks an infeasible path. */
export interface TestNarrowing {
  name: string;
  whenTrue: StaticValue | null;
  whenFalse: StaticValue | null;
}

interface Predicate {
  (value: StaticValue): boolean | null;
}

const alternativesOf = (value: StaticValue): StaticValue[] =>
  value.kind === "branch" ? value.alternatives : [value];

const partition = (
  value: StaticValue,
  predicate: Predicate,
  reason: string,
): [StaticValue | null, StaticValue | null] => {
  const passing: StaticValue[] = [];
  const failing: StaticValue[] = [];
  for (const alternative of alternativesOf(value)) {
    const verdict = predicate(alternative);
    if (verdict !== false) passing.push(alternative);
    if (verdict !== true) failing.push(alternative);
  }
  const rebuild = (alternatives: StaticValue[]): StaticValue | null =>
    alternatives.length === 0 ? null : branchValue(alternatives, reason);
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

const narrowIdentifier = (
  name: string,
  lookup: (name: string) => StaticValue | undefined,
  predicate: Predicate,
  reason: string,
): TestNarrowing | null => {
  const value = lookup(name);
  if (!value || value.kind !== "branch") return null;
  const [whenTrue, whenFalse] = partition(value, predicate, reason);
  return { name, whenTrue, whenFalse };
};

const negate = (narrowing: TestNarrowing | null): TestNarrowing | null =>
  narrowing && {
    name: narrowing.name,
    whenTrue: narrowing.whenFalse,
    whenFalse: narrowing.whenTrue,
  };

/**
 * Derives what a branch-valued identifier must be on each side of a test.
 * Handles `x`, `!x`, `x == null` / `x === undefined` (and their negations),
 * mirroring the narrowing TypeScript applies to the same expressions.
 */
export const narrowTest = (
  test: Expression,
  lookup: (name: string) => StaticValue | undefined,
): TestNarrowing | null => {
  switch (test.type) {
    case "Identifier":
      return narrowIdentifier(test.name, lookup, getTruthiness, `${test.name} is truthy`);
    case "UnaryExpression":
      return test.operator === "!" ? negate(narrowTest(test.argument, lookup)) : null;
    case "ParenthesizedExpression":
      return narrowTest(test.expression, lookup);
    case "BinaryExpression": {
      const isEquality = test.operator === "==" || test.operator === "===";
      const isInequality = test.operator === "!=" || test.operator === "!==";
      if (!isEquality && !isInequality) return null;
      const [operand, literalNode] =
        test.left.type === "Identifier" ? [test.left, test.right] : [test.right, test.left];
      const literal = getNullishLiteral(literalNode);
      if (operand.type !== "Identifier" || literal === false) return null;
      const isStrict = test.operator === "===" || test.operator === "!==";
      const narrowing = narrowIdentifier(
        operand.name,
        lookup,
        isStrict ? isExactly(literal) : isNullish,
        `${operand.name} is ${isStrict ? String(literal) : "nullish"}`,
      );
      return isEquality ? narrowing : negate(narrowing);
    }
    default:
      return null;
  }
};

/** Rebinds `name` in its owning scope for the duration of `run`. */
export const withNarrowedBinding = <Result>(
  scope: Scope,
  name: string,
  value: StaticValue,
  run: () => Result,
): Result => {
  const owner = findOwningScope(scope, name);
  if (!owner?.parent) return run();
  const previous = owner.bindings.get(name);
  owner.bindings.set(name, value);
  try {
    return run();
  } finally {
    if (previous && owner.bindings.get(name) === value) owner.bindings.set(name, previous);
  }
};

/** Rebinds `name` in its owning scope with no restore; the caller's fork snapshot undoes it. */
export const applyNarrowing = (scope: Scope, name: string, value: StaticValue): void => {
  const owner = findOwningScope(scope, name);
  if (owner?.parent) owner.bindings.set(name, value);
};

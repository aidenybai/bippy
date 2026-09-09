import type { Expression } from "oxc-parser";
import type { Scope, StaticValue } from "../types.js";
import { hasNamedProperty } from "./has-property.js";
import { findOwningScope } from "./scope.js";
import { getThrowCertainty } from "./thrown.js";
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
  lookup: (name: string) => StaticValue | undefined,
): TestNarrowing | null => {
  const primary = left ?? right;
  if (!primary) return null;
  const original = lookup(primary.name);
  if (!original) return null;
  const isOr = operator === "||";
  const sideOf = (narrowing: TestNarrowing): StaticValue | null =>
    isOr ? narrowing.whenFalse : narrowing.whenTrue;
  const combined =
    left && right && left.name === right.name
      ? intersect(sideOf(left), sideOf(right), `${primary.name} narrowed by ${operator}`)
      : sideOf(primary);
  return isOr
    ? { name: primary.name, whenTrue: original, whenFalse: combined }
    : { name: primary.name, whenTrue: combined, whenFalse: original };
};

/**
 * Derives what a branch-valued identifier must be on each side of a test.
 * Handles `x`, `!x`, `"key" in x`, `x == null` / `x === undefined` (and their negations)
 * and `||` / `&&` of those, mirroring the narrowing TypeScript applies to the same expressions.
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
    case "LogicalExpression":
      return test.operator === "??"
        ? null
        : narrowLogical(
            test.operator,
            narrowTest(test.left, lookup),
            narrowTest(test.right, lookup),
            lookup,
          );
    case "BinaryExpression": {
      if (test.operator === "in") {
        if (test.right.type !== "Identifier" || test.left.type !== "Literal") return null;
        const key = String(test.left.value);
        return narrowIdentifier(
          test.right.name,
          lookup,
          (value) => {
            const presence = hasNamedProperty(key, value);
            return presence === null ? null : getTruthiness(presence);
          },
          `"${key}" in ${test.right.name}`,
        );
      }
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
  lookup: (name: string) => StaticValue | undefined,
  evaluate: TestEvaluator,
): TestNarrowing | null => {
  const shape: PureTestShape = { identifiers: new Set(), calledRoots: new Set() };
  if (!collectPureTestShape(test, shape)) return null;
  const branched = [...shape.identifiers].filter((name) => lookup(name)?.kind === "branch");
  if (branched.length !== 1) return null;
  const [name] = branched;
  const value = lookup(name);
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
  );
  return { name, whenTrue, whenFalse };
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

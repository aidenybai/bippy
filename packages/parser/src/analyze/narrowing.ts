import type { Expression } from "@oxc-project/types";
import { getMemberLinks, unwrapExpression } from "../module/ast.js";
import { createScope, declareVariable, lookupVariable, type Scope } from "./scope.js";
import {
  conditional,
  getTruthiness,
  isNullish,
  isNullishValue,
  type Primitive,
  type StaticValue,
  UNDEFINED,
} from "./values.js";

/** Whether one arm of a value can exist on a path; `null` when the arm cannot tell. */
export type ArmFilter = (arm: StaticValue) => boolean | null;

/** A variable, or a property path below one, and the arms of its value a path keeps. */
export interface Narrowing {
  path: string[];
  keep: ArmFilter;
  /** Read through `?.`, so a nullish prefix yields `undefined` instead of failing. */
  isOptional: boolean;
}

const negate =
  (keep: ArmFilter): ArmFilter =>
  (arm) => {
    const verdict = keep(arm);
    return verdict === null ? null : !verdict;
  };

const either =
  (filters: ArmFilter[]): ArmFilter =>
  (arm) => {
    const verdicts = filters.map((filter) => filter(arm));
    if (verdicts.includes(true)) return true;
    return verdicts.includes(null) ? null : false;
  };

export const keepTruthy: ArmFilter = (arm) => getTruthiness(arm);
export const keepFalsy = negate(keepTruthy);

/** Values with structure are never equal to a primitive; only unknowns keep both outcomes open. */
const equalsPrimitive =
  (expected: Primitive, isLoose: boolean): ArmFilter =>
  (arm) => {
    switch (arm.kind) {
      case "literal":
        return isLoose && isNullish(expected) ? isNullish(arm.value) : arm.value === expected;
      case "text":
        return typeof expected === "string" ? null : false;
      case "unknown":
      case "external":
        return null;
      default:
        return false;
    }
  };

export const keepNullish = equalsPrimitive(undefined, true);
export const keepNonNullish = negate(keepNullish);

interface ComparedPrimitive {
  value: Primitive;
}

/** The primitive an operand compares against, when it is written as a literal or `undefined`. */
const getComparedPrimitive = (expression: Expression): ComparedPrimitive | null => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type === "Identifier" && unwrapped.name === "undefined")
    return { value: undefined };
  if (unwrapped.type === "Literal" && typeof unwrapped.value !== "object") {
    return { value: unwrapped.value };
  }
  return unwrapped.type === "Literal" && unwrapped.value === null ? { value: null } : null;
};

/** The variable an access or call spine starts from: `a` in `a[k].b()`. */
const getSpineRoot = (expression: Expression): string | null => {
  let current = unwrapExpression(expression);
  while (current.type === "MemberExpression" || current.type === "CallExpression") {
    current = unwrapExpression(
      current.type === "MemberExpression" ? current.object : current.callee,
    );
  }
  return current.type === "Identifier" ? current.name : null;
};

/**
 * Records what `keep` holding for `expression` says. A static member path
 * is narrowed in place; any other spine still tells that its root was
 * dereferenced when the outcome rules out a short-circuited `undefined`.
 */
const narrowExpression = (expression: Expression, keep: ArmFilter, into: Narrowing[]): void => {
  const links = getMemberLinks(expression);
  if (links && links[0].name !== "this") {
    into.push({
      path: links.map((link) => link.name),
      keep,
      isOptional: links.some((link) => link.isOptional),
    });
    return;
  }
  const root = keep(UNDEFINED) === false ? getSpineRoot(expression) : null;
  if (root !== null) into.push({ path: [root], keep: keepNonNullish, isOptional: false });
};

/**
 * What a test's `outcome` says about the variables it reads: `if (x)`,
 * `!x.y`, `x != null`, `x?.y === "a"`, and conjunctions or disjunctions
 * whose outcome decides every operand.
 */
export const collectNarrowings = (
  test: Expression,
  outcome: boolean,
  into: Narrowing[] = [],
): Narrowing[] => {
  const expression = unwrapExpression(test);
  switch (expression.type) {
    case "Identifier":
    case "MemberExpression":
    case "CallExpression":
    case "ChainExpression":
      narrowExpression(expression, outcome ? keepTruthy : keepFalsy, into);
      break;
    case "UnaryExpression":
      if (expression.operator === "!") collectNarrowings(expression.argument, !outcome, into);
      break;
    case "LogicalExpression":
      if ((expression.operator === "&&") === outcome && expression.operator !== "??") {
        collectNarrowings(expression.left, outcome, into);
        collectNarrowings(expression.right, outcome, into);
      }
      break;
    case "BinaryExpression": {
      const isEquality = expression.operator === "==" || expression.operator === "===";
      const isInequality = expression.operator === "!=" || expression.operator === "!==";
      if (!isEquality && !isInequality) break;
      const isLoose = expression.operator === "==" || expression.operator === "!=";
      const operands: [Expression, Expression][] = [
        [expression.left, expression.right],
        [expression.right, expression.left],
      ];
      for (const [side, other] of operands) {
        const compared = getComparedPrimitive(other);
        if (compared === null) continue;
        const keep = equalsPrimitive(compared.value, isLoose);
        narrowExpression(side, isEquality === outcome ? keep : negate(keep), into);
      }
      break;
    }
  }
  return into;
};

/** `discriminant === <one of the case tests>`, or its negation once the cases did not match. */
export const collectCaseNarrowings = (
  discriminant: Expression,
  tests: Expression[],
  isMatched: boolean,
): Narrowing[] => {
  const filters: ArmFilter[] = [];
  for (const test of tests) {
    const compared = getComparedPrimitive(test);
    if (compared === null) return [];
    filters.push(equalsPrimitive(compared.value, false));
  }
  if (filters.length === 0) return [];
  const into: Narrowing[] = [];
  const keep = either(filters);
  narrowExpression(discriminant, isMatched ? keep : negate(keep), into);
  return into;
};

/** Drops the arms of a branching value that `keep` rules out; `null` when none remain. */
export const keepArms = (value: StaticValue, keep: ArmFilter): StaticValue | null =>
  narrowPath(value, [], keep, false);

/**
 * Drops the arms of a value a path rules out at the end of `path`, walking
 * through objects and the arms of conditionals; `null` when nothing remains.
 * A nullish value met before the end of the path cannot be read further, so
 * it survives only where an optional chain would have yielded `undefined`.
 */
const narrowPath = (
  value: StaticValue,
  path: string[],
  keep: ArmFilter,
  isOptional: boolean,
): StaticValue | null => {
  if (value.kind === "conditional") {
    const whenTrue = narrowPath(value.whenTrue, path, keep, isOptional);
    const whenFalse = narrowPath(value.whenFalse, path, keep, isOptional);
    if (whenTrue === null) return whenFalse;
    if (whenFalse === null) return whenTrue;
    return whenTrue === value.whenTrue && whenFalse === value.whenFalse
      ? value
      : conditional(value.test, whenTrue, whenFalse);
  }
  if (path.length === 0) return keep(value) === false ? null : value;
  if (isNullishValue(value)) return isOptional && keep(UNDEFINED) !== false ? value : null;
  if (value.kind !== "object") return value;
  const [key, ...rest] = path;
  const property = value.properties.get(key);
  if (property === undefined) return value;
  const refined = narrowPath(property, rest, keep, isOptional);
  if (refined === null) return null;
  if (refined === property) return value;
  return { ...value, properties: new Map(value.properties).set(key, refined) };
};

/**
 * A scope for a path on which `narrowings` hold: variables whose values
 * branch lose the arms the path rules out. Writes go through to the
 * declaring scope, and a rewritten variable forgets what was assumed.
 */
export const narrowScope = (scope: Scope, narrowings: Narrowing[]): Scope => {
  let narrowed: Scope | null = null;
  for (const { path, keep, isOptional } of narrowings) {
    const [name, ...propertyPath] = path;
    const current = lookupVariable(narrowed ?? scope, name);
    if (current === undefined) continue;
    const refined = narrowPath(current, propertyPath, keep, isOptional);
    if (refined === null || refined === current) continue;
    narrowed ??= createScope(scope, "narrowing");
    declareVariable(narrowed, name, refined);
  }
  return narrowed ?? scope;
};

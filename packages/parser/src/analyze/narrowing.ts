import type { Expression } from "@oxc-project/types";
import { getMemberLinks, unwrapExpression } from "../module/ast.js";
import { equalsPrimitive } from "./operators.js";
import {
  createScope,
  declareVariable,
  isModuleScope,
  lookupVariable,
  type Scope,
} from "./scope.js";
import {
  assumeTest,
  conditional,
  getTruthiness,
  isNullishValue,
  type Primitive,
  type StaticValue,
  UNDEFINED,
} from "./values.js";

/** Whether one arm of a value can exist on a path; `null` when the arm cannot tell. */
export type ArmFilter = (arm: StaticValue) => boolean | null;

/** A variable, or a property path below one, and the arms of its value a path keeps. */
export interface PathNarrowing {
  kind: "path";
  path: string[];
  keep: ArmFilter;
  /** Read through `?.`, so a nullish prefix yields `undefined` instead of failing. */
  isOptional: boolean;
}

/** The outcome a path fixes for a test, so every value branching on that test loses the other arm. */
export interface TestAssumption {
  kind: "assumption";
  test: string;
  outcome: boolean;
}

export type Narrowing = PathNarrowing | TestAssumption;

/** The source text of a test, in the form conditional values quote it. */
export type DescribeTest = (test: Expression) => string;

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

const keepEqualTo =
  (expected: Primitive, isLoose: boolean): ArmFilter =>
  (arm) =>
    equalsPrimitive(arm, expected, !isLoose);

export const keepNullish = keepEqualTo(undefined, true);
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
      kind: "path",
      path: links.map((link) => link.name),
      keep,
      isOptional: links.some((link) => link.isOptional),
    });
    return;
  }
  const root = keep(UNDEFINED) === false ? getSpineRoot(expression) : null;
  if (root !== null) {
    into.push({ kind: "path", path: [root], keep: keepNonNullish, isOptional: false });
  }
};

/**
 * What a test's `outcome` says: values that branched on the same test lose
 * their other arm, and the variables it reads are refined for `if (x)`,
 * `!x.y`, `x != null`, `x?.y === "a"`, and conjunctions or disjunctions
 * whose outcome decides every operand.
 */
export const collectNarrowings = (
  test: Expression,
  outcome: boolean,
  describe: DescribeTest,
  into: Narrowing[] = [],
): Narrowing[] => {
  const expression = unwrapExpression(test);
  if (expression.type === "UnaryExpression" && expression.operator === "!") {
    return collectNarrowings(expression.argument, !outcome, describe, into);
  }
  into.push({ kind: "assumption", test: describe(test), outcome });
  switch (expression.type) {
    case "Identifier":
    case "MemberExpression":
    case "CallExpression":
    case "ChainExpression":
      narrowExpression(expression, outcome ? keepTruthy : keepFalsy, into);
      break;
    case "LogicalExpression":
      if ((expression.operator === "&&") === outcome && expression.operator !== "??") {
        collectNarrowings(expression.left, outcome, describe, into);
        collectNarrowings(expression.right, outcome, describe, into);
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
        const keep = keepEqualTo(compared.value, isLoose);
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
    filters.push(keepEqualTo(compared.value, false));
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

/** Names bound between `scope` and the module scope, whose bindings are too many to revisit. */
const getLocalNames = (scope: Scope): Set<string> => {
  const names = new Set<string>();
  for (
    let current: Scope | null = scope;
    current && !isModuleScope(current);
    current = current.parent
  )
    for (const name of current.variables.keys()) names.add(name);
  return names;
};

/**
 * A scope for a path on which `narrowings` hold: variables whose values
 * branch lose the arms the path rules out. Writes go through to the
 * declaring scope, and a rewritten variable forgets what was assumed.
 */
export const narrowScope = (scope: Scope, narrowings: Narrowing[]): Scope => {
  let narrowed: Scope | null = null;
  let localNames: Set<string> | null = null;
  const refine = (name: string, refined: StaticValue | null, current: StaticValue): void => {
    if (refined === null || refined === current) return;
    narrowed ??= createScope(scope, "narrowing");
    declareVariable(narrowed, name, refined);
  };
  for (const narrowing of narrowings) {
    if (narrowing.kind === "assumption") {
      localNames ??= getLocalNames(scope);
      for (const name of localNames) {
        const current = lookupVariable(narrowed ?? scope, name);
        if (current === undefined) continue;
        refine(name, assumeTest(current, narrowing.test, narrowing.outcome), current);
      }
      continue;
    }
    const [name, ...propertyPath] = narrowing.path;
    const current = lookupVariable(narrowed ?? scope, name);
    if (current === undefined) continue;
    refine(name, narrowPath(current, propertyPath, narrowing.keep, narrowing.isOptional), current);
  }
  return narrowed ?? scope;
};

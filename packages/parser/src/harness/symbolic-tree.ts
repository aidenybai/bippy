import { z } from "zod";
import { parseWithSchema } from "../errors.js";
import type { PatternBranch, PatternNode, PatternRepeat, RepeatBounds } from "./static-pattern.js";
import { workTagSchema } from "./snapshot.js";

// The symbolic tree is the static output: one tree whose uncertain nodes carry
// a guard, a boolean formula over named input variables. Everything the
// harness reports (states, membership, coverage, witnesses) is derived from it.

export type InputSourceKind =
  | "fetch"
  | "loader"
  | "database"
  | "environment"
  | "feature-flag"
  | "viewport"
  | "clock"
  | "random"
  | "storage"
  | "location"
  | "state"
  | "commit"
  | "root-props"
  | "collection"
  | "flight"
  | "path"
  | "unknown";

export interface InputVariable {
  /** Stable within one static render; the same interpreter unknown always maps to the same id. */
  id: string;
  label: string;
  source: InputSourceKind;
  location: string | null;
}

/** `value` reads the projection itself, `length` its `.length`, `typeof` its type tag, `choice` which of N paths a decision took. */
export type VariableMeasure = "value" | "length" | "typeof" | "choice";

export interface SymbolicVariable {
  input: string;
  /** Property path below the input; `[]` steps into an element of a collection. */
  path: string[];
  measure: VariableMeasure;
}

/** The path segment standing for any element of the collection before it. */
export const ELEMENT_SEGMENT = "[]";

export type GuardLiteral = string | number | boolean | null;

export type CompareOperator = "<" | "<=" | ">" | ">=";

export interface GuardConstant {
  kind: "constant";
  value: boolean;
}

export interface GuardTruthy {
  kind: "truthy";
  variable: SymbolicVariable;
}

export interface GuardEquals {
  kind: "eq";
  variable: SymbolicVariable;
  value: GuardLiteral;
}

export interface GuardCompare {
  kind: "compare";
  variable: SymbolicVariable;
  operator: CompareOperator;
  value: number;
}

export interface GuardInSet {
  kind: "in-set";
  variable: SymbolicVariable;
  values: GuardLiteral[];
}

export interface GuardNot {
  kind: "not";
  operand: Guard;
}

export interface GuardAnd {
  kind: "and";
  operands: Guard[];
}

export interface GuardOr {
  kind: "or";
  operands: Guard[];
}

export type Guard =
  | GuardConstant
  | GuardTruthy
  | GuardEquals
  | GuardCompare
  | GuardInSet
  | GuardNot
  | GuardAnd
  | GuardOr;

/**
 * What a `$Branch` marker carries: a two-way formula, an N-way choice
 * variable, or one guard per alternative for a branch flattened out of nested
 * decisions (`c ? (d ? a : b) : b` takes `b` under `or(and(c, not d), not c)`).
 */
export interface SymbolicPredicate {
  formula: Guard | null;
  choice: SymbolicVariable | null;
  guards: Guard[] | null;
  inputs: InputVariable[];
}

/** What a `$Repeat` marker carries: the collection whose length is the iteration count. */
export interface SymbolicCardinality {
  variable: SymbolicVariable;
  inputs: InputVariable[];
}

/** One committed tree and the guard over the `commit` input under which the capture shows it. */
export interface SymbolicCommit {
  guard: Guard;
  tree: PatternNode[];
}

export interface SymbolicTreeStats {
  nodes: number;
  inputs: number;
  guards: number;
  branches: number;
  repeats: number;
  opaque: number;
  wildcards: number;
}

export interface SymbolicTree {
  inputs: InputVariable[];
  commits: SymbolicCommit[];
  stats: SymbolicTreeStats;
}

export const COMMIT_INPUT_ID = "commit";

export const COMMIT_VARIABLE: SymbolicVariable = {
  input: COMMIT_INPUT_ID,
  path: [],
  measure: "choice",
};

const inputSourceKindSchema: z.ZodType<InputSourceKind> = z.enum([
  "fetch",
  "loader",
  "database",
  "environment",
  "feature-flag",
  "viewport",
  "clock",
  "random",
  "storage",
  "location",
  "state",
  "commit",
  "root-props",
  "collection",
  "flight",
  "path",
  "unknown",
]);

export const inputVariableSchema: z.ZodType<InputVariable> = z.object({
  id: z.string(),
  label: z.string(),
  source: inputSourceKindSchema,
  location: z.string().nullable(),
});

export const symbolicVariableSchema: z.ZodType<SymbolicVariable> = z.object({
  input: z.string(),
  path: z.array(z.string()),
  measure: z.enum(["value", "length", "typeof", "choice"]),
});

const guardLiteralSchema: z.ZodType<GuardLiteral> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const guardSchema: z.ZodType<Guard> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("constant"), value: z.boolean() }),
    z.object({ kind: z.literal("truthy"), variable: symbolicVariableSchema }),
    z.object({
      kind: z.literal("eq"),
      variable: symbolicVariableSchema,
      value: guardLiteralSchema,
    }),
    z.object({
      kind: z.literal("compare"),
      variable: symbolicVariableSchema,
      operator: z.enum(["<", "<=", ">", ">="]),
      value: z.number(),
    }),
    z.object({
      kind: z.literal("in-set"),
      variable: symbolicVariableSchema,
      values: z.array(guardLiteralSchema),
    }),
    z.object({ kind: z.literal("not"), operand: guardSchema }),
    z.object({ kind: z.literal("and"), operands: z.array(guardSchema) }),
    z.object({ kind: z.literal("or"), operands: z.array(guardSchema) }),
  ]),
);

export const symbolicPredicateSchema: z.ZodType<SymbolicPredicate> = z.object({
  formula: guardSchema.nullable(),
  choice: symbolicVariableSchema.nullable(),
  guards: z.array(guardSchema).nullable(),
  inputs: z.array(inputVariableSchema),
});

export const symbolicCardinalitySchema: z.ZodType<SymbolicCardinality> = z.object({
  variable: symbolicVariableSchema,
  inputs: z.array(inputVariableSchema),
});

const repeatBoundsSchema: z.ZodType<RepeatBounds> = z.object({
  min: z.number(),
  max: z.number().nullable(),
});

export const patternNodeSchema: z.ZodType<PatternNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("fiber"),
      tag: workTagSchema,
      name: z.string().nullable(),
      key: z.string().nullable(),
      children: z.array(patternNodeSchema),
    }),
    z.object({ kind: z.literal("text"), text: z.string().nullable() }),
    z.object({
      kind: z.literal("branch"),
      variable: z.string(),
      decision: z.string(),
      sharesScope: z.boolean(),
      reason: z.string(),
      location: z.string().nullable(),
      preferredIndex: z.number().nullable(),
      guards: z.array(guardSchema),
      inputs: z.array(inputVariableSchema),
      alternatives: z.array(z.array(patternNodeSchema)),
    }),
    z.object({
      kind: z.literal("repeat"),
      variable: z.string(),
      decision: z.string(),
      location: z.string().nullable(),
      cardinality: symbolicVariableSchema,
      inputs: z.array(inputVariableSchema),
      scopedInputs: z.array(z.string()),
      count: repeatBoundsSchema,
      children: z.array(patternNodeSchema),
    }),
    z.object({
      kind: z.literal("opaque"),
      name: z.string(),
      runtimeNames: z.array(z.string()).nullable(),
      key: z.string().nullable(),
      reason: z.string(),
      passedChildren: z.array(patternNodeSchema),
    }),
    z.object({
      kind: z.literal("wildcard"),
      reason: z.string(),
      isTruncated: z.boolean(),
    }),
  ]),
);

export const symbolicTreeStatsSchema: z.ZodType<SymbolicTreeStats> = z.object({
  nodes: z.number(),
  inputs: z.number(),
  guards: z.number(),
  branches: z.number(),
  repeats: z.number(),
  opaque: z.number(),
  wildcards: z.number(),
});

export const symbolicTreeSchema: z.ZodType<SymbolicTree> = z.object({
  inputs: z.array(inputVariableSchema),
  commits: z.array(z.object({ guard: guardSchema, tree: z.array(patternNodeSchema) })),
  stats: symbolicTreeStatsSchema,
});

export const serializeSymbolicPredicate = (predicate: SymbolicPredicate): string =>
  JSON.stringify(predicate);

export const parseSymbolicPredicate = (serialized: string): SymbolicPredicate =>
  parseWithSchema(symbolicPredicateSchema, JSON.parse(serialized), "branch predicate");

export interface NormalizedPredicate {
  predicate: SymbolicPredicate;
  /** The branch's alternatives are stored in the opposite order from the materializer's. */
  isSwapped: boolean;
}

/** `!flag ? A : B` decides the same variable as `flag ? B : A`; both are read as the latter. */
export const normalizePredicate = (
  predicate: SymbolicPredicate,
  alternativeCount: number,
): NormalizedPredicate => {
  if (predicate.formula?.kind !== "not" || alternativeCount !== 2) {
    return { predicate, isSwapped: false };
  }
  return { predicate: { ...predicate, formula: predicate.formula.operand }, isSwapped: true };
};

export const serializeSymbolicCardinality = (cardinality: SymbolicCardinality): string =>
  JSON.stringify(cardinality);

export const parseSymbolicCardinality = (serialized: string): SymbolicCardinality =>
  parseWithSchema(symbolicCardinalitySchema, JSON.parse(serialized), "repeat cardinality");

export const parseSymbolicTree = (serialized: string): SymbolicTree =>
  parseWithSchema(symbolicTreeSchema, JSON.parse(serialized), "symbolic tree");

export const truthyGuard = (variable: SymbolicVariable): Guard => ({ kind: "truthy", variable });

export const equalsGuard = (variable: SymbolicVariable, value: GuardLiteral): Guard => ({
  kind: "eq",
  variable,
  value,
});

export const compareGuard = (
  variable: SymbolicVariable,
  operator: CompareOperator,
  value: number,
): Guard => ({ kind: "compare", variable, operator, value });

export const inSetGuard = (variable: SymbolicVariable, values: GuardLiteral[]): Guard => ({
  kind: "in-set",
  variable,
  values,
});

export const constantGuard = (value: boolean): Guard => ({ kind: "constant", value });

/** `not(not(g))` is `g`; `not(constant)` folds. */
export const negateGuard = (guard: Guard): Guard => {
  if (guard.kind === "not") return guard.operand;
  if (guard.kind === "constant") return constantGuard(!guard.value);
  return { kind: "not", operand: guard };
};

export const andGuard = (operands: Guard[]): Guard => {
  const flattened = operands.flatMap((operand) =>
    operand.kind === "and" ? operand.operands : [operand],
  );
  if (flattened.some((operand) => operand.kind === "constant" && !operand.value))
    return constantGuard(false);
  const remaining = flattened.filter((operand) => operand.kind !== "constant");
  if (remaining.length === 0) return constantGuard(true);
  return remaining.length === 1 ? remaining[0] : { kind: "and", operands: remaining };
};

export const orGuard = (operands: Guard[]): Guard => {
  const flattened = operands.flatMap((operand) =>
    operand.kind === "or" ? operand.operands : [operand],
  );
  if (flattened.some((operand) => operand.kind === "constant" && operand.value))
    return constantGuard(true);
  const remaining = flattened.filter((operand) => operand.kind !== "constant");
  if (remaining.length === 0) return constantGuard(false);
  return remaining.length === 1 ? remaining[0] : { kind: "or", operands: remaining };
};

export const isSameVariable = (left: SymbolicVariable, right: SymbolicVariable): boolean =>
  left.input === right.input &&
  left.measure === right.measure &&
  left.path.length === right.path.length &&
  left.path.every((segment, index) => segment === right.path[index]);

export const collectGuardVariables = (
  guard: Guard,
  into: SymbolicVariable[] = [],
): SymbolicVariable[] => {
  const add = (variable: SymbolicVariable): void => {
    if (!into.some((candidate) => isSameVariable(candidate, variable))) into.push(variable);
  };
  switch (guard.kind) {
    case "constant":
      break;
    case "truthy":
    case "eq":
    case "compare":
    case "in-set":
      add(guard.variable);
      break;
    case "not":
      collectGuardVariables(guard.operand, into);
      break;
    case "and":
    case "or":
      for (const operand of guard.operands) collectGuardVariables(operand, into);
      break;
  }
  return into;
};

export const mapGuardVariables = (
  guard: Guard,
  map: (variable: SymbolicVariable) => SymbolicVariable,
): Guard => {
  switch (guard.kind) {
    case "constant":
      return guard;
    case "truthy":
    case "eq":
    case "compare":
    case "in-set":
      return { ...guard, variable: map(guard.variable) };
    case "not":
      return { kind: "not", operand: mapGuardVariables(guard.operand, map) };
    case "and":
    case "or":
      return {
        kind: guard.kind,
        operands: guard.operands.map((operand) => mapGuardVariables(operand, map)),
      };
  }
};

export const formatVariable = (variable: SymbolicVariable): string => {
  const projection = [variable.input, ...variable.path].join(".").replace(/\.\[\]/g, "[]");
  switch (variable.measure) {
    case "value":
      return projection;
    case "length":
      return `len(${projection})`;
    case "typeof":
      return `typeof(${projection})`;
    case "choice":
      return `choice(${projection})`;
  }
};

const formatLiteral = (value: GuardLiteral): string => JSON.stringify(value);

export const formatGuard = (guard: Guard): string => {
  switch (guard.kind) {
    case "constant":
      return String(guard.value);
    case "truthy":
      return `truthy(${formatVariable(guard.variable)})`;
    case "eq":
      return `eq(${formatVariable(guard.variable)}, ${formatLiteral(guard.value)})`;
    case "compare":
      return `${formatVariable(guard.variable)} ${guard.operator} ${guard.value}`;
    case "in-set":
      return `in(${formatVariable(guard.variable)}, [${guard.values.map(formatLiteral).join(", ")}])`;
    case "not":
      return `not(${formatGuard(guard.operand)})`;
    case "and":
      return `and(${guard.operands.map(formatGuard).join(", ")})`;
    case "or":
      return `or(${guard.operands.map(formatGuard).join(", ")})`;
  }
};

export const formatPredicate = (predicate: SymbolicPredicate): string => {
  if (predicate.formula) return formatGuard(predicate.formula);
  if (predicate.choice) return formatVariable(predicate.choice);
  if (predicate.guards) return predicate.guards.map(formatGuard).join(" | ");
  throw new Error("a branch predicate decides by a formula, a choice, or per-alternative guards");
};

/** How many atoms a guard formula is built from; the size the solver's work grows with. */
export const countGuardAtoms = (guard: Guard): number => {
  switch (guard.kind) {
    case "constant":
      return 0;
    case "not":
      return countGuardAtoms(guard.operand);
    case "and":
    case "or":
      return guard.operands.reduce((total, operand) => total + countGuardAtoms(operand), 0);
    default:
      return 1;
  }
};

/** The guard alternative `index` of an N-way choice is taken under. */
export const choiceGuard = (variable: SymbolicVariable, index: number): Guard =>
  equalsGuard(variable, index);

/**
 * Per-alternative guards of a marker predicate: `[g, not g]` for a formula, its
 * own for a flattened branch, and for a choice `eq(choice, i)` with the last
 * alternative taken under none of the others, so a choice ranges over exactly
 * its alternatives however the guards are composed or negated later.
 */
export const predicateGuards = (
  predicate: SymbolicPredicate,
  alternativeCount: number,
): Guard[] => {
  if (predicate.formula && alternativeCount === 2)
    return [predicate.formula, negateGuard(predicate.formula)];
  if (predicate.guards && predicate.guards.length === alternativeCount) return predicate.guards;
  if (predicate.choice) {
    const choice = predicate.choice;
    const named = Array.from({ length: alternativeCount - 1 }, (_, index) =>
      choiceGuard(choice, index),
    );
    return [...named, negateGuard(orGuard(named))];
  }
  throw new Error(`predicate does not decide ${alternativeCount} alternatives`);
};

/** Whether `predicateGuards` can name a guard per alternative: a formula only decides two. */
export const decidesAlternatives = (
  predicate: SymbolicPredicate,
  alternativeCount: number,
): boolean =>
  predicate.choice !== null ||
  (predicate.formula !== null && alternativeCount === 2) ||
  predicate.guards?.length === alternativeCount;

const countNodes = (nodes: PatternNode[], stats: SymbolicTreeStats): void => {
  for (const node of nodes) {
    stats.nodes++;
    switch (node.kind) {
      case "fiber":
        countNodes(node.children, stats);
        break;
      case "text":
        break;
      case "branch":
        stats.branches++;
        stats.guards += node.alternatives.length;
        for (const alternative of node.alternatives) countNodes(alternative, stats);
        break;
      case "repeat":
        stats.repeats++;
        stats.guards++;
        countNodes(node.children, stats);
        break;
      case "opaque":
        stats.opaque++;
        countNodes(node.passedChildren, stats);
        break;
      case "wildcard":
        stats.wildcards++;
        break;
    }
  }
};

export const computeSymbolicStats = (
  commits: SymbolicCommit[],
  inputs: InputVariable[],
): SymbolicTreeStats => {
  const stats: SymbolicTreeStats = {
    nodes: 0,
    inputs: inputs.length,
    guards: commits.length > 1 ? commits.length : 0,
    branches: 0,
    repeats: 0,
    opaque: 0,
    wildcards: 0,
  };
  for (const commit of commits) countNodes(commit.tree, stats);
  return stats;
};

const collectInputs = (nodes: PatternNode[], inputs: Map<string, InputVariable>): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        collectInputs(node.children, inputs);
        break;
      case "opaque":
        collectInputs(node.passedChildren, inputs);
        break;
      case "branch":
        for (const input of node.inputs) inputs.set(input.id, input);
        for (const alternative of node.alternatives) collectInputs(alternative, inputs);
        break;
      case "repeat":
        for (const input of node.inputs) inputs.set(input.id, input);
        collectInputs(node.children, inputs);
        break;
      case "text":
      case "wildcard":
        break;
    }
  }
};

/** The guard under which a decision node takes `choice`: the alternative's guard, or the repeat's cardinality equalling the count. */
export const decisionGuard = (node: PatternBranch | PatternRepeat, choice: number): Guard =>
  node.kind === "branch" ? node.guards[choice] : equalsGuard(node.cardinality, choice);

export const COMMIT_INPUT: InputVariable = {
  id: COMMIT_INPUT_ID,
  label: "commit",
  source: "commit",
  location: null,
};

/**
 * The symbolic tree of the committed pattern trees: the inputs every guard and
 * cardinality in them ranges over, and each commit guarded by which commit the
 * capture observed (a single commit needs no guard).
 */
export const buildSymbolicTree = (commits: PatternNode[][]): SymbolicTree => {
  const inputs = new Map<string, InputVariable>();
  if (commits.length > 1) inputs.set(COMMIT_INPUT.id, COMMIT_INPUT);
  const symbolicCommits = commits.map((tree, index) => {
    collectInputs(tree, inputs);
    return {
      guard: commits.length > 1 ? choiceGuard(COMMIT_VARIABLE, index) : constantGuard(true),
      tree,
    };
  });
  const inputList = [...inputs.values()];
  return {
    inputs: inputList,
    commits: symbolicCommits,
    stats: computeSymbolicStats(symbolicCommits, inputList),
  };
};

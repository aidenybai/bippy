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

interface GuardSequence {
  kind: "and" | "or";
  chunks: Guard[];
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

export interface GuardContext {
  guard: Guard;
  inputs: InputVariable[];
}

/** A branch's formula, choice variable, or guards for alternatives flattened from nested decisions. */
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

const guardHashCache = new WeakMap<Guard, number>();

const hashText = (value: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
};

const mixHash = (hash: number, value: number): number => Math.imul(hash ^ value, 16_777_619) >>> 0;

const getVariableHash = (variable: SymbolicVariable): number =>
  hashText(JSON.stringify([variable.input, variable.path, variable.measure]));

const getGuardHash = (guard: Guard): number => {
  const cached = guardHashCache.get(guard);
  if (cached !== undefined) return cached;
  let hash: number;
  switch (guard.kind) {
    case "constant":
      return hashText(JSON.stringify([guard.kind, guard.value]));
    case "truthy":
      return mixHash(hashText(guard.kind), getVariableHash(guard.variable));
    case "eq":
      return mixHash(
        mixHash(hashText(guard.kind), getVariableHash(guard.variable)),
        hashText(JSON.stringify(guard.value)),
      );
    case "compare":
      return mixHash(
        mixHash(
          mixHash(hashText(guard.kind), getVariableHash(guard.variable)),
          hashText(guard.operator),
        ),
        hashText(String(guard.value)),
      );
    case "in-set":
      hash = mixHash(hashText(guard.kind), getVariableHash(guard.variable));
      for (const value of guard.values) hash = mixHash(hash, hashText(JSON.stringify(value)));
      return hash;
    case "not":
      hash = mixHash(hashText(guard.kind), getGuardHash(guard.operand));
      break;
    case "and":
    case "or":
      hash = hashText(guard.kind);
      for (const operand of guard.operands) hash = mixHash(hash, getGuardHash(operand));
      break;
  }
  guardHashCache.set(guard, hash);
  return hash;
};

const hasSameGuard = (guardsByHash: Map<number, Guard[]>, guard: Guard): boolean =>
  guardsByHash.get(getGuardHash(guard))?.some((candidate) => isSameGuard(candidate, guard)) ??
  false;

const guardSizeCache = new WeakMap<Guard, number>();
const guardSequenceCache = new WeakMap<Guard, GuardSequence>();

const getGuardSize = (guard: Guard): number => guardSizeCache.get(guard) ?? 1;

const createGuardGroup = (kind: "and" | "or", operands: Guard[]): Guard => {
  const guard: Guard = { kind, operands };
  guardSizeCache.set(
    guard,
    operands.reduce((size, operand) => size + getGuardSize(operand), 0),
  );
  return guard;
};

const appendGuard = (kind: "and" | "or", base: Guard, operand: Guard): Guard => {
  const sequence = guardSequenceCache.get(base);
  const chunks = sequence?.kind === kind ? [...sequence.chunks] : [base];
  let chunk = operand;
  for (
    let previous = chunks.at(-1);
    previous !== undefined && getGuardSize(previous) === getGuardSize(chunk);
    previous = chunks.at(-1)
  ) {
    chunks.pop();
    chunk = createGuardGroup(kind, [previous, chunk]);
  }
  chunks.push(chunk);
  const guard = chunks.length === 1 ? chunks[0] : createGuardGroup(kind, chunks);
  guardSequenceCache.set(guard, { kind, chunks });
  return guard;
};

const combineGuards = (kind: "and" | "or", operands: Guard[], absorbing: boolean): Guard => {
  if (operands.some((operand) => operand.kind === "constant" && operand.value === absorbing))
    return constantGuard(absorbing);
  const remaining: Guard[] = [];
  const remainingByHash = new Map<number, Guard[]>();
  for (const operand of operands) {
    if (operand.kind === "constant") continue;
    if (hasSameGuard(remainingByHash, operand)) continue;
    const complement = negateGuard(operand);
    if (hasSameGuard(remainingByHash, complement)) return constantGuard(absorbing);
    remaining.push(operand);
    const hash = getGuardHash(operand);
    const matching = remainingByHash.get(hash);
    if (matching === undefined) remainingByHash.set(hash, [operand]);
    else matching.push(operand);
  }
  if (remaining.length === 0) return constantGuard(!absorbing);
  if (remaining.length === 1) return remaining[0];
  return remaining.length === 2
    ? appendGuard(kind, remaining[0], remaining[1])
    : createGuardGroup(kind, remaining);
};

export const andGuard = (operands: Guard[]): Guard => combineGuards("and", operands, false);

export const orGuard = (operands: Guard[]): Guard => combineGuards("or", operands, true);

export const combineGuardContexts = (
  contexts: GuardContext[],
  combine: (guards: Guard[]) => Guard,
): GuardContext => ({
  guard: combine(contexts.map((context) => context.guard)),
  inputs: [
    ...new Map(
      contexts.flatMap((context) => context.inputs).map((input) => [input.id, input]),
    ).values(),
  ],
});

export const isSameVariable = (left: SymbolicVariable, right: SymbolicVariable): boolean =>
  left.input === right.input &&
  left.measure === right.measure &&
  left.path.length === right.path.length &&
  left.path.every((segment, index) => segment === right.path[index]);

const isSameLiteralList = (left: GuardLiteral[], right: GuardLiteral[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const isSameGuard = (left: Guard, right: Guard): boolean => {
  switch (left.kind) {
    case "constant":
      return right.kind === "constant" && left.value === right.value;
    case "truthy":
      return right.kind === "truthy" && isSameVariable(left.variable, right.variable);
    case "eq":
      return (
        right.kind === "eq" &&
        isSameVariable(left.variable, right.variable) &&
        left.value === right.value
      );
    case "compare":
      return (
        right.kind === "compare" &&
        isSameVariable(left.variable, right.variable) &&
        left.operator === right.operator &&
        left.value === right.value
      );
    case "in-set":
      return (
        right.kind === "in-set" &&
        isSameVariable(left.variable, right.variable) &&
        isSameLiteralList(left.values, right.values)
      );
    case "not":
      return right.kind === "not" && isSameGuard(left.operand, right.operand);
    case "and":
    case "or":
      return (
        right.kind === left.kind &&
        left.operands.length === right.operands.length &&
        left.operands.every((operand, index) => isSameGuard(operand, right.operands[index]))
      );
  }
};

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

/** A formula's sides, explicit guards, or choice indices with a final catch-all alternative. */
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

export const decidesAlternatives = (
  predicate: SymbolicPredicate,
  alternativeCount: number,
): boolean =>
  predicate.choice !== null ||
  (predicate.formula !== null && alternativeCount === 2) ||
  predicate.guards?.length === alternativeCount;

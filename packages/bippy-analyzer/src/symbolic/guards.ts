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

const guardHashes = new WeakMap<Guard, number>();

const hashText = (text: string, seed: number): number => {
  let hash = seed;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
};

const mixHash = (hash: number, value: number): number => Math.imul(hash ^ value, 16_777_619) >>> 0;

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

const mixText = (hash: number, text: string): number =>
  mixHash(hash, hashText(text, 2_166_136_261));

const mixVariable = (hash: number, variable: SymbolicVariable): number => {
  let mixed = mixText(hash, variable.input);
  for (const segment of variable.path) mixed = mixText(mixed, segment);
  return mixText(mixed, variable.measure);
};

const mixLiteral = (hash: number, value: GuardLiteral): number =>
  mixText(mixText(hash, value === null ? "null" : typeof value), String(value));

const getGuardHash = (guard: Guard): number => {
  const cached = guardHashes.get(guard);
  if (cached !== undefined) return cached;
  let hash = hashText(guard.kind, 2_166_136_261);
  switch (guard.kind) {
    case "constant":
      hash = mixText(hash, String(guard.value));
      break;
    case "truthy":
      hash = mixVariable(hash, guard.variable);
      break;
    case "eq":
      hash = mixLiteral(mixVariable(hash, guard.variable), guard.value);
      break;
    case "compare":
      hash = mixText(mixVariable(hash, guard.variable), guard.operator);
      hash = mixText(hash, String(guard.value));
      break;
    case "in-set":
      hash = mixVariable(hash, guard.variable);
      for (const value of guard.values) hash = mixLiteral(hash, value);
      break;
    case "not":
      hash = mixHash(hash, getGuardHash(guard.operand));
      guardHashes.set(guard, hash);
      break;
    case "and":
    case "or":
      for (const operand of guard.operands) hash = mixHash(hash, getGuardHash(operand));
      guardHashes.set(guard, hash);
      break;
  }
  return hash;
};

const hasEquivalentGuard = (guards: Map<number, Guard[]>, guard: Guard): boolean =>
  guards
    .get(getGuardHash(guard))
    ?.some((candidate) => candidate === guard || isSameGuard(candidate, guard)) ?? false;

interface GuardEqualityGroup {
  firstIndex: number;
  values: GuardLiteral[];
  variable: SymbolicVariable;
}

const getVariableKey = (variable: SymbolicVariable): string =>
  JSON.stringify([variable.input, variable.path, variable.measure]);

const indexGuards = (guards: Guard[]): Map<number, Guard[]> => {
  const indexed = new Map<number, Guard[]>();
  for (const guard of guards) {
    const key = getGuardHash(guard);
    const matching = indexed.get(key);
    if (matching) matching.push(guard);
    else indexed.set(key, [guard]);
  }
  return indexed;
};

const mergeEqualityDisjuncts = (guards: Guard[]): Guard[] => {
  const groups = new Map<string, GuardEqualityGroup>();
  guards.forEach((guard, index) => {
    if (guard.kind !== "eq") return;
    const key = getVariableKey(guard.variable);
    const group = groups.get(key);
    if (group) group.values.push(guard.value);
    else groups.set(key, { firstIndex: index, values: [guard.value], variable: guard.variable });
  });
  if (![...groups.values()].some((group) => group.values.length > 1)) return guards;
  return guards.flatMap((guard, index) => {
    if (guard.kind !== "eq") return [guard];
    const group = groups.get(getVariableKey(guard.variable));
    if (group === undefined || group.values.length === 1) return [guard];
    return group.firstIndex === index ? [inSetGuard(group.variable, group.values)] : [];
  });
};

const isAbsorbedDisjunct = (guard: Guard, disjuncts: Map<number, Guard[]>): boolean => {
  if (guard.kind !== "and") return false;
  if (
    guard.operands.some(
      (operand) =>
        hasEquivalentGuard(disjuncts, operand) ||
        (operand.kind === "or" &&
          operand.operands.every((alternative) => hasEquivalentGuard(disjuncts, alternative))),
    )
  )
    return true;
  const operands = indexGuards(guard.operands);
  for (const candidates of disjuncts.values()) {
    for (const candidate of candidates) {
      if (
        candidate !== guard &&
        candidate.kind === "and" &&
        candidate.operands.length < guard.operands.length &&
        candidate.operands.every((operand) => hasEquivalentGuard(operands, operand))
      )
        return true;
    }
  }
  return false;
};

const isAbsorbedConjunct = (guard: Guard, conjuncts: Map<number, Guard[]>): boolean => {
  if (guard.kind !== "or") return false;
  if (guard.operands.some((operand) => hasEquivalentGuard(conjuncts, operand))) return true;
  const operands = indexGuards(guard.operands);
  for (const candidates of conjuncts.values()) {
    for (const candidate of candidates) {
      if (
        candidate !== guard &&
        candidate.kind === "or" &&
        candidate.operands.length < guard.operands.length &&
        candidate.operands.every((operand) => hasEquivalentGuard(operands, operand))
      )
        return true;
    }
  }
  return false;
};

const reduceCoveredNegation = (guard: Guard, disjuncts: Map<number, Guard[]>): Guard => {
  if (guard.kind !== "and") return guard;
  const operands = guard.operands.filter((operand) => {
    if (operand.kind !== "not") return true;
    return operand.operand.kind === "or"
      ? !operand.operand.operands.every((alternative) => hasEquivalentGuard(disjuncts, alternative))
      : !hasEquivalentGuard(disjuncts, operand.operand);
  });
  return operands.length === guard.operands.length ? guard : combineGuards("and", operands, false);
};

const reduceCoveredConjuncts = (guard: Guard, conjuncts: Map<number, Guard[]>): Guard => {
  if (guard.kind !== "not" || guard.operand.kind !== "and") return guard;
  const operands = guard.operand.operands.filter(
    (operand) => !hasEquivalentGuard(conjuncts, operand),
  );
  return operands.length === guard.operand.operands.length
    ? guard
    : negateGuard(combineGuards("and", operands, false));
};

const combineGuards = (kind: "and" | "or", operands: Guard[], absorbing: boolean): Guard => {
  const flattened = operands.flatMap((operand) =>
    operand.kind === kind ? operand.operands : [operand],
  );
  if (flattened.some((operand) => operand.kind === "constant" && operand.value === absorbing))
    return constantGuard(absorbing);
  const remaining: Guard[] = [];
  const remainingByHash = new Map<number, Guard[]>();
  for (const operand of flattened) {
    if (operand.kind === "constant") continue;
    if (hasEquivalentGuard(remainingByHash, operand)) continue;
    const complement = negateGuard(operand);
    if (hasEquivalentGuard(remainingByHash, complement)) return constantGuard(absorbing);
    remaining.push(operand);
    const key = getGuardHash(operand);
    const matching = remainingByHash.get(key);
    if (matching) matching.push(operand);
    else remainingByHash.set(key, [operand]);
  }
  if (remaining.length === 0) return constantGuard(!absorbing);
  const merged = kind === "or" ? mergeEqualityDisjuncts(remaining) : remaining;
  const mergedByHash = merged === remaining ? remainingByHash : indexGuards(merged);
  const simplified =
    kind === "or"
      ? merged.filter((operand) => !isAbsorbedDisjunct(operand, mergedByHash))
      : merged.filter((operand) => !isAbsorbedConjunct(operand, mergedByHash));
  if (kind === "or") {
    const simplifiedByHash = simplified === merged ? mergedByHash : indexGuards(simplified);
    const reduced = simplified.map((operand) => reduceCoveredNegation(operand, simplifiedByHash));
    if (reduced.some((operand, index) => operand !== simplified[index])) {
      return combineGuards("or", reduced, true);
    }
  } else {
    const reduced = simplified.map((operand) => reduceCoveredConjuncts(operand, mergedByHash));
    if (reduced.some((operand, index) => operand !== simplified[index])) {
      return combineGuards("and", reduced, false);
    }
  }
  return simplified.length === 1 ? simplified[0] : { kind, operands: simplified };
};

export const andGuard = (operands: Guard[]): Guard => combineGuards("and", operands, false);

export const orGuard = (operands: Guard[]): Guard => combineGuards("or", operands, true);

const simplifiedGuards = new WeakMap<Guard, Guard>();

export const simplifyGuard = (guard: Guard): Guard => {
  const cached = simplifiedGuards.get(guard);
  if (cached !== undefined) return cached;
  const simplified =
    guard.kind === "and"
      ? andGuard(guard.operands.map(simplifyGuard))
      : guard.kind === "or"
        ? orGuard(guard.operands.map(simplifyGuard))
        : guard.kind === "not"
          ? negateGuard(simplifyGuard(guard.operand))
          : guard;
  simplifiedGuards.set(guard, simplified);
  return simplified;
};

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

const isAtomicGuard = (
  guard: Guard,
): guard is GuardTruthy | GuardEquals | GuardCompare | GuardInSet =>
  guard.kind === "truthy" ||
  guard.kind === "eq" ||
  guard.kind === "compare" ||
  guard.kind === "in-set";

const satisfiesComparison = (value: GuardLiteral, guard: GuardCompare): boolean => {
  if (typeof value !== "number") return false;
  switch (guard.operator) {
    case "<":
      return value < guard.value;
    case "<=":
      return value <= guard.value;
    case ">":
      return value > guard.value;
    case ">=":
      return value >= guard.value;
  }
};

const isAtomicGuardImplied = (
  premise: GuardTruthy | GuardEquals | GuardCompare | GuardInSet,
  conclusion: GuardTruthy | GuardEquals | GuardCompare | GuardInSet,
): boolean => {
  if (!isSameVariable(premise.variable, conclusion.variable)) return false;
  if (premise.kind === "eq") {
    switch (conclusion.kind) {
      case "truthy":
        return Boolean(premise.value);
      case "eq":
        return premise.value === conclusion.value;
      case "in-set":
        return conclusion.values.includes(premise.value);
      case "compare":
        return satisfiesComparison(premise.value, conclusion);
    }
  }
  if (premise.kind === "in-set") {
    switch (conclusion.kind) {
      case "truthy":
        return premise.values.every(Boolean);
      case "eq":
        return (
          premise.values.length > 0 && premise.values.every((value) => value === conclusion.value)
        );
      case "in-set":
        return premise.values.every((value) => conclusion.values.includes(value));
      case "compare":
        return premise.values.every((value) => satisfiesComparison(value, conclusion));
    }
  }
  return false;
};

const areAtomicGuardsDisjoint = (
  left: GuardTruthy | GuardEquals | GuardCompare | GuardInSet,
  right: GuardTruthy | GuardEquals | GuardCompare | GuardInSet,
): boolean => {
  if (!isSameVariable(left.variable, right.variable)) return false;
  if (left.kind === "eq") return !isAtomicGuardImplied(left, right);
  if (right.kind === "eq") return !isAtomicGuardImplied(right, left);
  if (left.kind === "in-set" && right.kind === "in-set") {
    return !left.values.some((value) => right.values.includes(value));
  }
  if (left.kind === "truthy" && right.kind === "in-set")
    return right.values.every((value) => !value);
  if (left.kind === "in-set" && right.kind === "truthy")
    return left.values.every((value) => !value);
  return false;
};

const disjointGuards = new WeakMap<Guard, WeakMap<Guard, boolean>>();

const computeGuardsDisjoint = (left: Guard, right: Guard): boolean => {
  if (isAtomicGuard(left) && isAtomicGuard(right)) return areAtomicGuardsDisjoint(left, right);
  if (left.kind === "and")
    return left.operands.some((operand) => areGuardsDisjoint(operand, right));
  if (right.kind === "and")
    return right.operands.some((operand) => areGuardsDisjoint(left, operand));
  if (left.kind === "or")
    return left.operands.every((operand) => areGuardsDisjoint(operand, right));
  if (right.kind === "or")
    return right.operands.every((operand) => areGuardsDisjoint(left, operand));
  return false;
};

const areGuardsDisjoint = (left: Guard, right: Guard): boolean => {
  const cached = disjointGuards.get(left)?.get(right);
  if (cached !== undefined) return cached;
  const isDisjoint = computeGuardsDisjoint(left, right);
  let rightGuards = disjointGuards.get(left);
  if (rightGuards === undefined) {
    rightGuards = new WeakMap();
    disjointGuards.set(left, rightGuards);
  }
  rightGuards.set(right, isDisjoint);
  return isDisjoint;
};

const isSameLiteralList = (left: GuardLiteral[], right: GuardLiteral[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameGuards = new WeakMap<Guard, WeakMap<Guard, boolean>>();

const computeSameGuard = (left: Guard, right: Guard): boolean => {
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

export const isSameGuard = (left: Guard, right: Guard): boolean => {
  if (left === right) return true;
  if (getGuardHash(left) !== getGuardHash(right)) return false;
  const cached = sameGuards.get(left)?.get(right);
  if (cached !== undefined) return cached;
  const isSame = computeSameGuard(left, right);
  let rightGuards = sameGuards.get(left);
  if (rightGuards === undefined) {
    rightGuards = new WeakMap();
    sameGuards.set(left, rightGuards);
  }
  rightGuards.set(right, isSame);
  return isSame;
};

const impliedGuards = new WeakMap<Guard, WeakMap<Guard, boolean>>();

const computeGuardImplication = (premise: Guard, conclusion: Guard): boolean => {
  if (isSameGuard(premise, conclusion)) return true;
  if (
    premise.kind === "and" &&
    premise.operands.some((operand) => operand === conclusion || isSameGuard(operand, conclusion))
  )
    return true;
  if (isAtomicGuard(premise) && isAtomicGuard(conclusion))
    return isAtomicGuardImplied(premise, conclusion);
  if (conclusion.kind === "not" && areGuardsDisjoint(premise, conclusion.operand)) return true;
  if (conclusion.kind === "constant") return conclusion.value;
  if (premise.kind === "constant") return !premise.value;
  if (conclusion.kind === "and")
    return conclusion.operands.every((operand) => isGuardImplied(premise, operand));
  if (conclusion.kind === "or")
    return conclusion.operands.some((operand) => isGuardImplied(premise, operand));
  if (premise.kind === "and")
    return premise.operands.some((operand) => isGuardImplied(operand, conclusion));
  if (premise.kind === "or")
    return premise.operands.every((operand) => isGuardImplied(operand, conclusion));
  if (premise.kind === "not" && conclusion.kind === "not")
    return isGuardImplied(conclusion.operand, premise.operand);
  return false;
};

export const isGuardImplied = (premise: Guard, conclusion: Guard): boolean => {
  if (premise === conclusion) return true;
  const cached = impliedGuards.get(premise)?.get(conclusion);
  if (cached !== undefined) return cached;
  const isImplied = computeGuardImplication(premise, conclusion);
  let conclusions = impliedGuards.get(premise);
  if (conclusions === undefined) {
    conclusions = new WeakMap();
    impliedGuards.set(premise, conclusions);
  }
  conclusions.set(conclusion, isImplied);
  return isImplied;
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
    const namedValues = Array.from({ length: alternativeCount - 1 }, (_, index) => index);
    return [
      ...namedValues.map((value) => choiceGuard(choice, value)),
      negateGuard(inSetGuard(choice, namedValues)),
    ];
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

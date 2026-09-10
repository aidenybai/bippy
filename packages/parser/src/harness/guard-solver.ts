import {
  type Guard,
  type GuardCompare,
  type GuardEquals,
  type GuardInSet,
  type GuardLiteral,
  type GuardTruthy,
  type SymbolicVariable,
  formatVariable,
} from "./symbolic-tree.js";

// A finite-domain check over guard conjunctions: each symbolic variable ranges
// over JavaScript values, and a set of atoms about one variable (its truthiness,
// equality to literals, numeric comparisons, its `typeof`) is consistent when
// some value satisfies them all. Disjunctions split; everything else is
// decided per variable, so the check is small and never guesses.

type GuardAtom = GuardTruthy | GuardEquals | GuardCompare | GuardInSet;

interface Literal {
  atom: GuardAtom;
  isNegated: boolean;
}

/** A value a witness run would feed an input: a literal, or just a value of some type when no literal is pinned down. */
export type WitnessValue = GuardLiteral | { typeof: TypeName };

export interface VariableWitness {
  variable: SymbolicVariable;
  value: WitnessValue;
}

export type TypeName =
  | "undefined"
  | "object"
  | "boolean"
  | "number"
  | "bigint"
  | "string"
  | "symbol"
  | "function";

const ALL_TYPES: TypeName[] = [
  "undefined",
  "object",
  "boolean",
  "number",
  "bigint",
  "string",
  "symbol",
  "function",
];

const projectionKey = (variable: SymbolicVariable): string =>
  formatVariable({ ...variable, measure: "value" });

interface Bound {
  value: number;
  isOpen: boolean;
}

interface NumberDomain {
  lower: Bound;
  upper: Bound;
  isInteger: boolean;
}

const compareLiteral = (candidate: GuardLiteral, atom: GuardCompare): boolean => {
  if (typeof candidate !== "number") return false;
  switch (atom.operator) {
    case "<":
      return candidate < atom.value;
    case "<=":
      return candidate <= atom.value;
    case ">":
      return candidate > atom.value;
    case ">=":
      return candidate >= atom.value;
  }
};

const holdsFor = (candidate: GuardLiteral, literal: Literal): boolean => {
  const { atom } = literal;
  let holds: boolean;
  switch (atom.kind) {
    case "truthy":
      holds = Boolean(candidate);
      break;
    case "eq":
      holds = candidate === atom.value;
      break;
    case "in-set":
      holds = atom.values.includes(candidate);
      break;
    case "compare":
      holds = compareLiteral(candidate, atom);
      break;
  }
  return holds !== literal.isNegated;
};

const literalType = (candidate: GuardLiteral): TypeName =>
  candidate === null
    ? "object"
    : typeof candidate === "string"
      ? "string"
      : typeof candidate === "number"
        ? "number"
        : "boolean";

const pinnedCandidates = (literals: Literal[]): GuardLiteral[] | null => {
  let candidates: GuardLiteral[] | null = null;
  for (const literal of literals) {
    if (literal.isNegated) continue;
    const values =
      literal.atom.kind === "eq"
        ? [literal.atom.value]
        : literal.atom.kind === "in-set"
          ? literal.atom.values
          : null;
    if (values === null) continue;
    candidates =
      candidates === null ? values : candidates.filter((value) => values.includes(value));
  }
  return candidates;
};

const tightenLower = (domain: NumberDomain, value: number, isOpen: boolean): void => {
  if (value > domain.lower.value || (value === domain.lower.value && isOpen)) {
    domain.lower = { value, isOpen };
  }
};

const tightenUpper = (domain: NumberDomain, value: number, isOpen: boolean): void => {
  if (value < domain.upper.value || (value === domain.upper.value && isOpen)) {
    domain.upper = { value, isOpen };
  }
};

const applyComparison = (domain: NumberDomain, atom: GuardCompare, isNegated: boolean): void => {
  const operator = isNegated
    ? { "<": ">=", "<=": ">", ">": "<=", ">=": "<" }[atom.operator]
    : atom.operator;
  switch (operator) {
    case "<":
      tightenUpper(domain, atom.value, true);
      break;
    case "<=":
      tightenUpper(domain, atom.value, false);
      break;
    case ">":
      tightenLower(domain, atom.value, true);
      break;
    case ">=":
      tightenLower(domain, atom.value, false);
      break;
  }
};

const integerBounds = (domain: NumberDomain): [number, number] => {
  const lower =
    Math.ceil(domain.lower.value) +
    (domain.lower.isOpen && Number.isInteger(domain.lower.value) ? 1 : 0);
  const upper =
    Math.floor(domain.upper.value) -
    (domain.upper.isOpen && Number.isInteger(domain.upper.value) ? 1 : 0);
  return [lower, upper];
};

/** Some number (integer when required) in the domain that satisfies every literal; null when there is none. */
const pickNumber = (literals: Literal[], isInteger: boolean): number | null => {
  const domain: NumberDomain = {
    lower: { value: isInteger ? 0 : -Infinity, isOpen: false },
    upper: { value: Infinity, isOpen: false },
    isInteger,
  };
  for (const literal of literals) {
    if (literal.atom.kind === "compare") applyComparison(domain, literal.atom, literal.isNegated);
  }
  const others = literals.filter((literal) => literal.atom.kind !== "compare");
  const satisfies = (candidate: number): boolean =>
    others.every((literal) => holdsFor(candidate, literal));
  if (domain.lower.value > domain.upper.value) return null;
  if (domain.lower.value === domain.upper.value) {
    if (domain.lower.isOpen || domain.upper.isOpen) return null;
    return satisfies(domain.lower.value) ? domain.lower.value : null;
  }
  const [lower, upper] = integerBounds(domain);
  if (isInteger && lower > upper) return null;
  const excluded = others.filter(
    (literal) => literal.isNegated || literal.atom.kind === "truthy",
  ).length;
  const start = Number.isFinite(lower) ? lower : Number.isFinite(upper) ? upper - excluded - 2 : 0;
  const end = Number.isFinite(upper) ? upper : start + excluded + 2;
  for (let candidate = start; candidate <= end; candidate++) {
    if (satisfies(candidate)) return candidate;
  }
  if (isInteger) return null;
  const midpoint = (domain.lower.value + domain.upper.value) / 2;
  return Number.isFinite(midpoint) && satisfies(midpoint) ? midpoint : null;
};

const wantsFalsy = (literals: Literal[]): boolean =>
  literals.some((literal) => literal.atom.kind === "truthy" && literal.isNegated);

const wantsTruthy = (literals: Literal[]): boolean =>
  literals.some((literal) => literal.atom.kind === "truthy" && !literal.isNegated);

const hasPositiveComparison = (literals: Literal[]): boolean =>
  literals.some((literal) => literal.atom.kind === "compare" && !literal.isNegated);

/** Some value of type `type` satisfying `literals` when no literal pins the value down; undefined when the type admits none. */
const pickOfType = (type: TypeName, literals: Literal[]): WitnessValue | undefined => {
  const satisfies = (candidate: GuardLiteral): boolean =>
    literals.every((literal) => holdsFor(candidate, literal));
  if (hasPositiveComparison(literals) && type !== "number") return undefined;
  switch (type) {
    case "undefined":
      return wantsTruthy(literals) ? undefined : { typeof: "undefined" };
    case "boolean":
      return satisfies(true) ? true : satisfies(false) ? false : undefined;
    case "object":
      if (!wantsFalsy(literals)) return { typeof: "object" };
      return satisfies(null) ? null : undefined;
    case "number": {
      const picked = pickNumber(literals, false);
      return picked === null ? undefined : picked;
    }
    case "string": {
      if (wantsFalsy(literals)) return satisfies("") ? "" : undefined;
      for (let attempt = 0; attempt <= literals.length + 1; attempt++) {
        const candidate = `witness-${attempt}`;
        if (satisfies(candidate)) return candidate;
      }
      return undefined;
    }
    case "bigint":
      return { typeof: "bigint" };
    case "symbol":
    case "function":
      return wantsFalsy(literals) ? undefined : { typeof: type };
  }
};

/** Types the `typeof` literals of a projection leave open. */
const admittedTypes = (typeofLiterals: Literal[]): TypeName[] | null => {
  let types = ALL_TYPES;
  for (const literal of typeofLiterals) {
    const { atom } = literal;
    switch (atom.kind) {
      case "truthy":
        if (literal.isNegated) return null;
        break;
      case "compare":
        break;
      case "eq":
      case "in-set": {
        const named = atom.kind === "eq" ? [atom.value] : atom.values;
        types = types.filter((type) => named.includes(type) !== literal.isNegated);
      }
    }
  }
  return types;
};

interface ProjectionLiterals {
  variable: SymbolicVariable;
  value: Literal[];
  typeof: Literal[];
  length: Literal[];
  choice: Literal[];
}

const groupByProjection = (literals: Literal[]): Map<string, ProjectionLiterals> => {
  const groups = new Map<string, ProjectionLiterals>();
  for (const literal of literals) {
    const { variable } = literal.atom;
    const key = projectionKey(variable);
    let group = groups.get(key);
    if (!group) {
      group = { variable, value: [], typeof: [], length: [], choice: [] };
      groups.set(key, group);
    }
    group[variable.measure].push(literal);
  }
  return groups;
};

const pickValue = (group: ProjectionLiterals): VariableWitness | null => {
  const types = admittedTypes(group.typeof);
  if (types === null) return null;
  const variable: SymbolicVariable = { ...group.variable, measure: "value" };
  const pinned = pinnedCandidates(group.value);
  if (pinned !== null) {
    const candidate = pinned.find(
      (value) =>
        types.includes(literalType(value)) &&
        group.value.every((literal) => holdsFor(value, literal)),
    );
    return candidate === undefined ? null : { variable, value: candidate };
  }
  for (const type of types) {
    const picked = pickOfType(type, group.value);
    if (picked !== undefined) return { variable, value: picked };
  }
  return null;
};

const pickCount = (
  group: ProjectionLiterals,
  measure: "length" | "choice",
): VariableWitness | null => {
  const literals = group[measure];
  if (literals.length === 0) return null;
  const pinned = pinnedCandidates(literals);
  const variable: SymbolicVariable = { ...group.variable, measure };
  if (pinned !== null) {
    const candidate = pinned.find(
      (value) =>
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        literals.every((literal) => holdsFor(value, literal)),
    );
    return candidate === undefined ? null : { variable, value: candidate };
  }
  const picked = pickNumber(literals, true);
  return picked === null ? null : { variable, value: picked };
};

const modelOfLiterals = (literals: Literal[]): VariableWitness[] | null => {
  const witnesses: VariableWitness[] = [];
  for (const group of groupByProjection(literals).values()) {
    if (group.value.length > 0 || group.typeof.length > 0) {
      const witness = pickValue(group);
      if (witness === null) return null;
      witnesses.push(witness);
    }
    for (const measure of ["length", "choice"] as const) {
      if (group[measure].length === 0) continue;
      const witness = pickCount(group, measure);
      if (witness === null) return null;
      witnesses.push(witness);
    }
  }
  return witnesses;
};

const negateOperands = (operands: Guard[]): Guard[] =>
  operands.map((operand) => ({ kind: "not", operand }));

/** DPLL over the guard formulas: disjunctions split, atoms accumulate, and a full set of atoms is checked per variable. */
const findModel = (pending: Guard[], literals: Literal[]): VariableWitness[] | null => {
  const remaining = [...pending];
  const collected = [...literals];
  while (remaining.length > 0) {
    const guard = remaining.pop();
    if (!guard) break;
    switch (guard.kind) {
      case "constant":
        if (!guard.value) return null;
        break;
      case "and":
        remaining.push(...guard.operands);
        break;
      case "or":
        for (const operand of guard.operands) {
          const model = findModel([...remaining, operand], collected);
          if (model) return model;
        }
        return null;
      case "not": {
        const { operand } = guard;
        switch (operand.kind) {
          case "constant":
            if (operand.value) return null;
            break;
          case "not":
            remaining.push(operand.operand);
            break;
          case "and":
            remaining.push({ kind: "or", operands: negateOperands(operand.operands) });
            break;
          case "or":
            remaining.push(...negateOperands(operand.operands));
            break;
          default:
            collected.push({ atom: operand, isNegated: true });
        }
        break;
      }
      default:
        collected.push({ atom: guard, isNegated: false });
    }
  }
  return modelOfLiterals(collected);
};

/** A witness assignment satisfying every guard, or null when they contradict. */
export const solveGuards = (guards: Guard[]): VariableWitness[] | null => findModel(guards, []);

/** Witness values by symbolic variable (`formatVariable`), the form the planner evaluates guards against. */
export type WitnessModel = ReadonlyMap<string, WitnessValue>;

export const toWitnessModel = (witnesses: VariableWitness[]): WitnessModel =>
  new Map(witnesses.map((witness) => [formatVariable(witness.variable), witness.value]));

const isTypedPlaceholder = (value: WitnessValue): value is { typeof: TypeName } =>
  typeof value === "object" && value !== null;

/** Whether a value of type `type` (no literal pinned) satisfies the atom; null when values of that type differ on it. */
const typeHolds = (type: TypeName, atom: GuardAtom): boolean | null => {
  switch (atom.kind) {
    case "truthy":
      return type === "undefined"
        ? false
        : type === "object" || type === "function" || type === "symbol"
          ? true
          : null;
    case "eq":
      return literalType(atom.value) === type ? null : false;
    case "in-set":
      return atom.values.some((value) => literalType(value) === type) ? null : false;
    case "compare":
      return type === "number" ? null : false;
  }
};

const atomHolds = (atom: GuardAtom, model: WitnessModel): boolean | null => {
  const value = model.get(formatVariable(atom.variable));
  if (value === undefined) {
    if (atom.variable.measure !== "typeof") return null;
    const base = model.get(formatVariable({ ...atom.variable, measure: "value" }));
    if (base === undefined) return null;
    const type = isTypedPlaceholder(base) ? base.typeof : literalType(base);
    return holdsFor(type, { atom, isNegated: false });
  }
  if (isTypedPlaceholder(value)) return typeHolds(value.typeof, atom);
  return holdsFor(value, { atom, isNegated: false });
};

const negateVerdict = (verdict: boolean | null): boolean | null =>
  verdict === null ? null : !verdict;

/** Three-valued: true or false when the model decides the guard, null when a variable it needs is unassigned. */
export const evaluateGuard = (guard: Guard, model: WitnessModel): boolean | null => {
  switch (guard.kind) {
    case "constant":
      return guard.value;
    case "not":
      return negateVerdict(evaluateGuard(guard.operand, model));
    case "and": {
      const verdicts = guard.operands.map((operand) => evaluateGuard(operand, model));
      return verdicts.includes(false) ? false : verdicts.includes(null) ? null : true;
    }
    case "or": {
      const verdicts = guard.operands.map((operand) => evaluateGuard(operand, model));
      return verdicts.includes(true) ? true : verdicts.includes(null) ? null : false;
    }
    default:
      return atomHolds(guard, model);
  }
};

export const areGuardsSatisfiable = (guards: Guard[]): boolean => solveGuards(guards) !== null;

/** Guards asserted along one search path; `push` refuses a guard that would make the path contradictory. */
export class GuardSolver {
  private readonly stack: Guard[] = [];

  get guards(): readonly Guard[] {
    return this.stack;
  }

  push(guard: Guard): boolean {
    if (!areGuardsSatisfiable([...this.stack, guard])) return false;
    this.stack.push(guard);
    return true;
  }

  pop(): void {
    this.stack.pop();
  }
}

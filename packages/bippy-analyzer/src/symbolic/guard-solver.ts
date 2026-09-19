import {
  type Guard,
  type GuardCompare,
  type GuardEquals,
  type GuardInSet,
  type GuardLiteral,
  type GuardOr,
  type GuardTruthy,
  type SymbolicVariable,
  formatVariable,
} from "./guards.js";

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

interface ProjectionNode {
  id: number;
  children: Map<string, ProjectionNode>;
}

const projectionRoots = new Map<string, ProjectionNode>();
const projectionKeyCache = new WeakMap<SymbolicVariable, number>();
let nextProjectionId = 0;

const projectionKey = (variable: SymbolicVariable): number => {
  const cached = projectionKeyCache.get(variable);
  if (cached !== undefined) return cached;
  let node = projectionRoots.get(variable.input);
  if (node === undefined) {
    node = { id: nextProjectionId++, children: new Map() };
    projectionRoots.set(variable.input, node);
  }
  for (const segment of variable.path) {
    let child = node.children.get(segment);
    if (child === undefined) {
      child = { id: nextProjectionId++, children: new Map() };
      node.children.set(segment, child);
    }
    node = child;
  }
  projectionKeyCache.set(variable, node.id);
  return node.id;
};

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

const groupByProjection = (literals: Literal[]): Map<number, ProjectionLiterals> => {
  const groups = new Map<number, ProjectionLiterals>();
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
  if (wantsFalsy(group.value) && wantsTruthy(group.value)) return null;
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

const isGuardImpliedByLiterals = (
  guard: Guard,
  literals: Literal[],
  isNegated = false,
): boolean => {
  switch (guard.kind) {
    case "constant":
      return guard.value !== isNegated;
    case "not":
      return isGuardImpliedByLiterals(guard.operand, literals, !isNegated);
    case "and":
      return isNegated
        ? guard.operands.some((operand) => isGuardImpliedByLiterals(operand, literals, true))
        : guard.operands.every((operand) => isGuardImpliedByLiterals(operand, literals));
    case "or":
      return isNegated
        ? guard.operands.every((operand) => isGuardImpliedByLiterals(operand, literals, true))
        : guard.operands.some((operand) => isGuardImpliedByLiterals(operand, literals));
    default:
      return (
        modelOfLiterals([...literals, { atom: guard, isNegated: !isNegated }]) === null
      );
  }
};

/**
 * DPLL over the guard formulas: atoms accumulate and are checked per variable
 * before any disjunction splits, so a contradiction among the atoms is found
 * without exploring the disjunctions' product.
 */
const findModel = (pending: Guard[], literals: Literal[]): VariableWitness[] | null => {
  const remaining = [...pending];
  const collected = [...literals];
  const disjunctions: GuardOr[] = [];
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
        disjunctions.push(guard);
        break;
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
  const model = modelOfLiterals(collected);
  if (model === null) return null;
  const unresolvedDisjunctions: GuardOr[] = [];
  let selectedDisjunction: GuardOr | null = null;
  let selectedOperands: Guard[] = [];
  for (const disjunction of disjunctions) {
    if (isGuardImpliedByLiterals(disjunction, collected)) continue;
    const viableOperands = disjunction.operands.filter(
      (operand) => !isGuardImpliedByLiterals(operand, collected, true),
    );
    if (viableOperands.length === 0) return null;
    if (viableOperands.length === 1) {
      return findModel(
        [...disjunctions.filter((candidate) => candidate !== disjunction), viableOperands[0]],
        collected,
      );
    }
    unresolvedDisjunctions.push(disjunction);
    if (selectedDisjunction === null || viableOperands.length < selectedOperands.length) {
      selectedDisjunction = disjunction;
      selectedOperands = viableOperands;
    }
  }
  if (selectedDisjunction === null) return model;
  const remainingDisjunctions = unresolvedDisjunctions.filter(
    (candidate) => candidate !== selectedDisjunction,
  );
  for (const operand of selectedOperands) {
    const split = findModel([...remainingDisjunctions, operand], collected);
    if (split) return split;
  }
  return null;
};

const conjuncts = (guards: Guard[]): Guard[] =>
  guards.flatMap((guard) => {
    if (guard.kind === "and") return conjuncts(guard.operands);
    if (guard.kind === "not" && guard.operand.kind === "not")
      return conjuncts([guard.operand.operand]);
    if (guard.kind === "not" && guard.operand.kind === "or") {
      return conjuncts(negateOperands(guard.operand.operands));
    }
    return [guard];
  });

const collectProjectionKeys = (guard: Guard, keys: Set<number>): Set<number> => {
  switch (guard.kind) {
    case "constant":
      break;
    case "not":
      collectProjectionKeys(guard.operand, keys);
      break;
    case "and":
    case "or":
      for (const operand of guard.operands) collectProjectionKeys(operand, keys);
      break;
    default:
      keys.add(projectionKey(guard.variable));
  }
  return keys;
};

const projectionKeysCache = new WeakMap<Guard, ReadonlySet<number>>();

const getProjectionKeys = (guard: Guard): ReadonlySet<number> => {
  const cached = projectionKeysCache.get(guard);
  if (cached !== undefined) return cached;
  const keys = collectProjectionKeys(guard, new Set());
  projectionKeysCache.set(guard, keys);
  return keys;
};

interface GuardComponent {
  id: number;
  keys: Set<number>;
  guards: Guard[];
}

interface GuardAnalysis {
  componentByKey: Map<number, GuardComponent>;
  isSatisfiable: boolean;
}

/**
 * Conjuncts partitioned by the variables they mention: atoms are decided per
 * variable, so a disjunction only interacts with the conjuncts sharing one of
 * its variables and each component is solved on its own instead of splitting
 * every disjunction against every other.
 */
const independentComponents = (guards: Guard[]): GuardComponent[] => {
  const components = new Map<number, GuardComponent>();
  const componentByKey = new Map<number, GuardComponent>();
  let nextComponentId = 0;
  for (const guard of conjuncts(guards)) {
    const keys = new Set(getProjectionKeys(guard));
    const overlappingComponents = new Set<GuardComponent>();
    for (const key of keys) {
      const component = componentByKey.get(key);
      if (component !== undefined) overlappingComponents.add(component);
    }
    const merged: GuardComponent = {
      id: nextComponentId++,
      keys,
      guards: [guard],
    };
    const orderedComponents = [...overlappingComponents].sort((left, right) => right.id - left.id);
    for (const component of orderedComponents) {
      for (const key of component.keys) merged.keys.add(key);
      merged.guards.push(...component.guards);
      components.delete(component.id);
    }
    components.set(merged.id, merged);
    for (const key of merged.keys) componentByKey.set(key, merged);
  }
  return [...components.values()];
};

/** A witness assignment satisfying every guard, or null when they contradict. */
export const solveGuards = (guards: Guard[]): VariableWitness[] | null => {
  const witnesses: VariableWitness[] = [];
  for (const component of independentComponents(guards)) {
    const model = findModel(component.guards, []);
    if (model === null) return null;
    witnesses.push(...model);
  }
  return witnesses;
};

/** Witness values by symbolic variable (`formatVariable`), the form the planner evaluates guards against. */
type WitnessModel = ReadonlyMap<string, WitnessValue>;

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

const MAX_CACHED_GUARD_ANALYSES = 16;
const guardAnalysisCache = new Map<Guard, GuardAnalysis>();

const getGuardAnalysis = (guard: Guard): GuardAnalysis => {
  const cached = guardAnalysisCache.get(guard);
  if (cached !== undefined) {
    guardAnalysisCache.delete(guard);
    guardAnalysisCache.set(guard, cached);
    return cached;
  }
  const components = independentComponents([guard]);
  const componentByKey = new Map<number, GuardComponent>();
  let isSatisfiable = true;
  for (const component of components) {
    for (const key of component.keys) componentByKey.set(key, component);
    if (isSatisfiable && findModel(component.guards, []) === null) isSatisfiable = false;
  }
  const analysis = { componentByKey, isSatisfiable };
  guardAnalysisCache.set(guard, analysis);
  if (guardAnalysisCache.size > MAX_CACHED_GUARD_ANALYSES) {
    const oldest = guardAnalysisCache.keys().next();
    if (!oldest.done) guardAnalysisCache.delete(oldest.value);
  }
  return analysis;
};

const areGuardPairSatisfiable = (base: Guard, candidate: Guard): boolean => {
  const baseAnalysis = getGuardAnalysis(base);
  if (!baseAnalysis.isSatisfiable) return false;
  const overlappingComponents = new Set<GuardComponent>();
  for (const key of getProjectionKeys(candidate)) {
    const component = baseAnalysis.componentByKey.get(key);
    if (component !== undefined) overlappingComponents.add(component);
  }
  if (overlappingComponents.size === 0) return solveGuards([candidate]) !== null;
  return (
    solveGuards([
      ...[...overlappingComponents].flatMap((component) => component.guards),
      candidate,
    ]) !== null
  );
};

export const areGuardsSatisfiable = (guards: Guard[]): boolean => {
  if (guards.length === 0) return true;
  if (guards.length === 1) return getGuardAnalysis(guards[0]).isSatisfiable;
  if (guards.length === 2) return areGuardPairSatisfiable(guards[0], guards[1]);
  return solveGuards(guards) !== null;
};

/** Guards asserted along one search path; `push` refuses a guard that would make the path contradictory. */
export class GuardSolver {
  private readonly stack: Guard[] = [];

  push(guard: Guard): boolean {
    if (!areGuardsSatisfiable([...this.stack, guard])) return false;
    this.stack.push(guard);
    return true;
  }

  pop(): void {
    this.stack.pop();
  }
}

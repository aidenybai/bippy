import {
  andGuard,
  type Guard,
  type GuardCompare,
  type GuardEquals,
  type GuardInSet,
  type GuardLiteral,
  type GuardOr,
  type GuardTruthy,
  type SymbolicVariable,
  formatVariable,
  getGuardImplicationChecker,
  negateGuard,
  simplifyGuard,
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

const projectionKeys = new WeakMap<SymbolicVariable, string>();

const projectionKey = (variable: SymbolicVariable): string => {
  const cached = projectionKeys.get(variable);
  if (cached !== undefined) return cached;
  const key = JSON.stringify([variable.input, variable.path]);
  projectionKeys.set(variable, key);
  return key;
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
  const excluded = others.reduce((total, literal) => {
    if (literal.atom.kind === "truthy") return total + 1;
    if (!literal.isNegated) return total;
    if (literal.atom.kind === "in-set") return total + literal.atom.values.length;
    return total + 1;
  }, 0);
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

interface GuardModelState {
  groups: Map<string, ProjectionLiterals>;
  witnessesByProjection: Map<string, VariableWitness[]>;
}

interface GuardModelChange {
  key: string;
  previousGroup: ProjectionLiterals | undefined;
  previousWitnesses: VariableWitness[] | undefined;
}

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

const modelOfGroup = (group: ProjectionLiterals): VariableWitness[] | null => {
  const witnesses: VariableWitness[] = [];
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
  return witnesses;
};

const negateOperands = (operands: Guard[]): Guard[] =>
  operands.map((operand) => ({ kind: "not", operand }));

const getLiteral = (guard: Guard): Literal | null => {
  if (
    guard.kind === "truthy" ||
    guard.kind === "eq" ||
    guard.kind === "compare" ||
    guard.kind === "in-set"
  )
    return { atom: guard, isNegated: false };
  if (
    guard.kind === "not" &&
    (guard.operand.kind === "truthy" ||
      guard.operand.kind === "eq" ||
      guard.operand.kind === "compare" ||
      guard.operand.kind === "in-set")
  )
    return { atom: guard.operand, isNegated: true };
  return null;
};

/**
 * DPLL over the guard formulas: atoms accumulate and are checked per variable
 * before any disjunction splits, so a contradiction among the atoms is found
 * without exploring the disjunctions' product.
 */
const findModel = (
  pending: Guard[],
  state: GuardModelState = {
    groups: new Map(),
    witnessesByProjection: new Map(),
  },
): VariableWitness[] | null => {
  const remaining = [...pending];
  const disjunctions: GuardOr[] = [];
  const changedProjections = new Set<string>();
  const changes: GuardModelChange[] = [];
  const addLiteral = (literal: Literal): void => {
    const { variable } = literal.atom;
    const key = projectionKey(variable);
    let group = state.groups.get(key);
    if (!changedProjections.has(key)) {
      changes.push({
        key,
        previousGroup: group,
        previousWitnesses: state.witnessesByProjection.get(key),
      });
      group = group
        ? {
            variable: group.variable,
            value: [...group.value],
            typeof: [...group.typeof],
            length: [...group.length],
            choice: [...group.choice],
          }
        : { variable, value: [], typeof: [], length: [], choice: [] };
      state.groups.set(key, group);
      changedProjections.add(key);
    }
    if (group === undefined) {
      group = { variable, value: [], typeof: [], length: [], choice: [] };
      state.groups.set(key, group);
      changedProjections.add(key);
    }
    group[variable.measure].push(literal);
  };
  const isLiteralCompatible = (literal: Literal): boolean => {
    const { variable } = literal.atom;
    const group = state.groups.get(projectionKey(variable));
    if (group === undefined) return true;
    const extended = {
      variable: group.variable,
      value: [...group.value],
      typeof: [...group.typeof],
      length: [...group.length],
      choice: [...group.choice],
    };
    extended[variable.measure].push(literal);
    return modelOfGroup(extended) !== null;
  };
  try {
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
              addLiteral({ atom: operand, isNegated: true });
          }
          break;
        }
        default:
          addLiteral({ atom: guard, isNegated: false });
      }
    }
    for (const key of changedProjections) {
      const group = state.groups.get(key);
      if (group === undefined) continue;
      const witnesses = modelOfGroup(group);
      if (witnesses === null) return null;
      state.witnessesByProjection.set(key, witnesses);
    }
    if (disjunctions.length === 0) return [...state.witnessesByProjection.values()].flat();
    let disjunctionIndex = 0;
    for (let index = 1; index < disjunctions.length; index++) {
      if (disjunctions[index].operands.length < disjunctions[disjunctionIndex].operands.length) {
        disjunctionIndex = index;
      }
    }
    const [disjunction] = disjunctions.splice(disjunctionIndex, 1);
    const viableOperands: Guard[] = [];
    for (const operand of disjunction.operands) {
      const literal = getLiteral(operand);
      if (literal === null) {
        viableOperands.push(operand);
        continue;
      }
      if (!isLiteralCompatible(literal)) continue;
      if (!isLiteralCompatible({ atom: literal.atom, isNegated: !literal.isNegated })) {
        return findModel(disjunctions, state);
      }
      viableOperands.push(operand);
    }
    for (const operand of viableOperands) {
      const split = findModel([...disjunctions, operand], state);
      if (split) return split;
    }
    return null;
  } finally {
    let change = changes.pop();
    while (change !== undefined) {
      if (change.previousGroup === undefined) state.groups.delete(change.key);
      else state.groups.set(change.key, change.previousGroup);
      if (change.previousWitnesses === undefined) state.witnessesByProjection.delete(change.key);
      else state.witnessesByProjection.set(change.key, change.previousWitnesses);
      change = changes.pop();
    }
  }
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

const collectProjectionKeys = (guard: Guard, keys: Set<string>): Set<string> => {
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

interface GuardComponent {
  id: number;
  keys: Set<string>;
  guards: Guard[];
}

interface GuardAnalysis {
  components: GuardComponent[];
  componentByKey: Map<string, GuardComponent>;
  isSatisfiable: boolean | null;
  models: WitnessModel[];
}

/**
 * Conjuncts partitioned by the variables they mention: atoms are decided per
 * variable, so a disjunction only interacts with the conjuncts sharing one of
 * its variables and each component is solved on its own instead of splitting
 * every disjunction against every other.
 */
const independentComponents = (guards: Guard[]): GuardComponent[] => {
  const components = new Map<number, GuardComponent>();
  const componentByKey = new Map<string, GuardComponent>();
  let nextComponentId = 0;
  for (const guard of conjuncts(guards)) {
    const keys = collectProjectionKeys(guard, new Set());
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
    const model = findModel(component.guards);
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
const MAX_CACHED_GUARD_MODELS = 16;
const guardAnalysisCache = new Map<Guard, GuardAnalysis>();

const getGuardAnalysis = (guard: Guard): GuardAnalysis => {
  const cached = guardAnalysisCache.get(guard);
  if (cached !== undefined) {
    guardAnalysisCache.delete(guard);
    guardAnalysisCache.set(guard, cached);
    return cached;
  }
  const components = independentComponents([guard]);
  const componentByKey = new Map<string, GuardComponent>();
  for (const component of components) {
    for (const key of component.keys) componentByKey.set(key, component);
  }
  const analysis: GuardAnalysis = {
    components,
    componentByKey,
    isSatisfiable: null,
    models: [],
  };
  guardAnalysisCache.set(guard, analysis);
  if (guardAnalysisCache.size > MAX_CACHED_GUARD_ANALYSES) {
    const oldest = guardAnalysisCache.keys().next();
    if (!oldest.done) guardAnalysisCache.delete(oldest.value);
  }
  return analysis;
};

const solveGuardAnalysis = (analysis: GuardAnalysis): boolean => {
  if (analysis.isSatisfiable !== null) return analysis.isSatisfiable;
  const model = new Map<string, WitnessValue>();
  for (const component of analysis.components) {
    const witnesses = findModel(component.guards);
    if (witnesses === null) {
      analysis.isSatisfiable = false;
      return false;
    }
    for (const witness of witnesses) {
      model.set(formatVariable(witness.variable), witness.value);
    }
  }
  analysis.isSatisfiable = true;
  analysis.models.push(model);
  return true;
};

const areGuardPairSatisfiable = (base: Guard, candidate: Guard): boolean => {
  const baseAnalysis = getGuardAnalysis(base);
  if (!solveGuardAnalysis(baseAnalysis)) return false;
  if (baseAnalysis.models.some((model) => evaluateGuard(candidate, model) === true)) return true;
  const overlappingComponents = new Set<GuardComponent>();
  for (const key of collectProjectionKeys(candidate, new Set())) {
    const component = baseAnalysis.componentByKey.get(key);
    if (component !== undefined) overlappingComponents.add(component);
  }
  const witnesses =
    overlappingComponents.size === 0
      ? solveGuards([candidate])
      : solveGuards([
          ...[...overlappingComponents].flatMap((component) => component.guards),
          candidate,
        ]);
  if (witnesses === null) return false;
  if (baseAnalysis.models.length < MAX_CACHED_GUARD_MODELS) {
    const model = new Map(baseAnalysis.models[0]);
    for (const witness of witnesses) {
      model.set(formatVariable(witness.variable), witness.value);
    }
    baseAnalysis.models.push(model);
  }
  return true;
};

export const isGuardCompatibleWithActivePath = (base: Guard, candidate: Guard): boolean => {
  const simplifiedBase = simplifyGuard(base);
  const simplifiedCandidate = simplifyGuard(candidate);
  if (simplifiedBase.kind === "constant" && !simplifiedBase.value) return false;
  const isImplied = getGuardImplicationChecker(simplifiedBase);
  const narrowedCandidate =
    simplifiedCandidate.kind === "and"
      ? andGuard(simplifiedCandidate.operands.filter((operand) => !isImplied(operand)))
      : simplifiedCandidate.kind === "not" && simplifiedCandidate.operand.kind === "and"
        ? negateGuard(
            andGuard(
              simplifiedCandidate.operand.operands.filter((operand) => !isImplied(operand)),
            ),
          )
        : simplifiedCandidate;
  if (narrowedCandidate.kind === "constant") return narrowedCandidate.value;
  const baseAnalysis = getGuardAnalysis(simplifiedBase);
  const overlappingComponents = new Set<GuardComponent>();
  for (const key of collectProjectionKeys(narrowedCandidate, new Set())) {
    const component = baseAnalysis.componentByKey.get(key);
    if (component !== undefined) overlappingComponents.add(component);
  }
  return overlappingComponents.size === 0
    ? solveGuards([narrowedCandidate]) !== null
    : solveGuards([
        ...[...overlappingComponents].flatMap((component) => component.guards),
        narrowedCandidate,
      ]) !== null;
};

export const areGuardsSatisfiable = (guards: Guard[]): boolean => {
  const relevant = guards.filter((guard) => guard.kind !== "constant" || !guard.value);
  if (relevant.some((guard) => guard.kind === "constant")) return false;
  if (relevant.length === 0) return true;
  if (relevant.length === 1) return solveGuardAnalysis(getGuardAnalysis(relevant[0]));
  if (relevant.length === 2) return areGuardPairSatisfiable(relevant[0], relevant[1]);
  return solveGuards(relevant) !== null;
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

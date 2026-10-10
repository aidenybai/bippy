import type { AbstractValue, BinaryExpressionValue, BindingValue, SymbolicValue } from "./types.js";
import {
  canTypeEqualLiteral,
  formatAbstractValue,
  formatSymbolicValue,
  getBindingPlaceKey,
  getKnownTruthiness,
  getNegatedOperator,
  getTestExpression,
  getTruthiness,
  isEqualToLiteral,
} from "./values.js";

export const CONSTANT_ATOM = "#";
const LENGTH_SUFFIX = ".length";
const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
const NEGATED_EQUALITY_OPERATORS = new Set(["!==", "!="]);
const BOUND_OPERATORS = new Set(["<", "<=", ">", ">=", "===", "=="]);
const BOOLEAN_OPERATORS = new Set([...EQUALITY_OPERATORS, "<", "<=", ">", ">="]);

/**
 * A difference constraint `left - right <= constant` (or `<` when strict) between two
 * numeric places. `#` stands for the constant zero.
 */
export interface Bound {
  left: string;
  right: string;
  constant: number;
  isStrict: boolean;
}

interface LinearTerm {
  atom: string;
  constant: number;
}

interface Distance {
  weight: number;
  isStrict: boolean;
}

interface Fact {
  outcome: boolean;
  bindingIds: Set<number>;
}

/**
 * What is known along one path through the render tree: the values each place can still
 * hold, the outcomes of tests that couldn't be reduced to a place, and numeric bounds.
 */
export interface Knowledge {
  values: Map<string, AbstractValue[]>;
  facts: Map<string, Fact>;
  bounds: Bound[];
}

export const createKnowledge = (values: Map<string, AbstractValue[]>): Knowledge => ({
  values,
  facts: new Map(),
  bounds: [],
});

export const cloneKnowledge = (knowledge: Knowledge): Knowledge => ({
  values: new Map(knowledge.values),
  facts: new Map(knowledge.facts),
  bounds: [...knowledge.bounds],
});

export const getLengthAtom = (bindingId: number): string => `${bindingId}${LENGTH_SUFFIX}`;

const collectBindingIds = (value: SymbolicValue, bindingIds = new Set<number>()): Set<number> => {
  switch (value.kind) {
    case "Binding":
      bindingIds.add(value.binding.id);
      break;
    case "BinaryExpression":
      collectBindingIds(value.left, bindingIds);
      collectBindingIds(value.right, bindingIds);
      break;
    case "UnaryExpression":
      collectBindingIds(value.value, bindingIds);
      break;
    case "Conditional":
      collectBindingIds(value.test, bindingIds);
      collectBindingIds(value.consequent, bindingIds);
      collectBindingIds(value.alternate, bindingIds);
      break;
    default:
      break;
  }
  return bindingIds;
};

const getLinearTerm = (value: SymbolicValue): LinearTerm | null => {
  if (value.kind === "Primitive")
    return typeof value.value === "number" ? { atom: CONSTANT_ATOM, constant: value.value } : null;
  if (value.kind === "Binding") return { atom: getBindingPlaceKey(value), constant: 0 };
  if (
    value.kind === "UnaryExpression" &&
    value.operator === "-" &&
    value.value.kind === "Primitive" &&
    typeof value.value.value === "number"
  ) {
    return { atom: CONSTANT_ATOM, constant: -value.value.value };
  }
  if (value.kind === "BinaryExpression" && (value.operator === "+" || value.operator === "-")) {
    const left = getLinearTerm(value.left);
    const right = getLinearTerm(value.right);
    if (!left || !right) return null;
    const sign = value.operator === "+" ? 1 : -1;
    if (right.atom === CONSTANT_ATOM)
      return { atom: left.atom, constant: left.constant + sign * right.constant };
    if (left.atom === CONSTANT_ATOM && sign === 1)
      return { atom: right.atom, constant: left.constant + right.constant };
  }
  return null;
};

const getBounds = (value: SymbolicValue, outcome: boolean): Bound[] | null => {
  if (value.kind !== "BinaryExpression") return null;
  const operator = outcome ? value.operator : getNegatedOperator(value.operator);
  if (!operator || !BOUND_OPERATORS.has(operator)) return null;
  const left = getLinearTerm(value.left);
  const right = getLinearTerm(value.right);
  if (!left || !right || (left.atom === CONSTANT_ATOM && right.atom === CONSTANT_ATOM)) return null;
  const difference = right.constant - left.constant;
  const lessThan = (isStrict: boolean): Bound => ({
    left: left.atom,
    right: right.atom,
    constant: difference,
    isStrict,
  });
  const greaterThan = (isStrict: boolean): Bound => ({
    left: right.atom,
    right: left.atom,
    constant: -difference,
    isStrict,
  });
  switch (operator) {
    case "<":
      return [lessThan(true)];
    case "<=":
      return [lessThan(false)];
    case ">":
      return [greaterThan(true)];
    case ">=":
      return [greaterThan(false)];
    default:
      return [lessThan(false), greaterThan(false)];
  }
};

const isShorter = (candidate: Distance, current: Distance): boolean =>
  candidate.weight < current.weight ||
  (candidate.weight === current.weight && candidate.isStrict && !current.isStrict);

/**
 * Checks a set of difference constraints for a contradiction with Floyd–Warshall: the
 * constraints are inconsistent exactly when some atom has a negative cycle to itself.
 * Every `.length` is also known to be at least zero.
 */
const areBoundsConsistent = (bounds: Bound[]): boolean => {
  const lengthBounds = bounds
    .flatMap((bound) => [bound.left, bound.right])
    .filter((atom) => atom.endsWith(LENGTH_SUFFIX))
    .map((atom): Bound => ({ left: CONSTANT_ATOM, right: atom, constant: 0, isStrict: false }));
  const allBounds = [...bounds, ...lengthBounds];
  const atoms = [
    ...new Set([CONSTANT_ATOM, ...allBounds.flatMap((bound) => [bound.left, bound.right])]),
  ];
  const atomIndices = new Map(atoms.map((atom, index) => [atom, index]));
  const distances = atoms.map((_row, rowIndex) =>
    atoms.map((_column, columnIndex): Distance => ({
      weight: rowIndex === columnIndex ? 0 : Infinity,
      isStrict: false,
    })),
  );
  const getIndex = (atom: string): number => atomIndices.get(atom) ?? 0;
  for (const bound of allBounds) {
    const row = distances[getIndex(bound.right)];
    const column = getIndex(bound.left);
    const candidate = { weight: bound.constant, isStrict: bound.isStrict };
    if (isShorter(candidate, row[column])) row[column] = candidate;
  }
  for (let middle = 0; middle < atoms.length; middle++) {
    for (let from = 0; from < atoms.length; from++) {
      for (let to = 0; to < atoms.length; to++) {
        const first = distances[from][middle];
        const second = distances[middle][to];
        const candidate = {
          weight: first.weight + second.weight,
          isStrict: first.isStrict || second.isStrict,
        };
        if (isShorter(candidate, distances[from][to])) distances[from][to] = candidate;
      }
    }
  }
  return distances.every((row, index) => {
    const self = row[index];
    return !(self.weight < 0 || (self.weight === 0 && self.isStrict));
  });
};

const evaluateBounds = (value: SymbolicValue, knowledge: Knowledge): boolean | null => {
  if (knowledge.bounds.length === 0) return null;
  const whenTrue = getBounds(value, true);
  const whenFalse = getBounds(value, false);
  if (whenTrue && !areBoundsConsistent([...knowledge.bounds, ...whenTrue])) return false;
  if (whenFalse && !areBoundsConsistent([...knowledge.bounds, ...whenFalse])) return true;
  return null;
};

const getPlaceValues = (value: SymbolicValue, knowledge: Knowledge): AbstractValue[] | null =>
  value.kind === "Binding" ? (knowledge.values.get(getBindingPlaceKey(value)) ?? null) : null;

const isBooleanExpression = (value: SymbolicValue): boolean =>
  (value.kind === "BinaryExpression" && BOOLEAN_OPERATORS.has(value.operator)) ||
  (value.kind === "UnaryExpression" && value.operator === "!");

/**
 * Gives the literal a value must be when the knowledge decides it: a place narrowed to one
 * literal, or a comparison whose outcome is known.
 */
export const resolveLiteral = (value: SymbolicValue, knowledge: Knowledge): SymbolicValue => {
  if (isBooleanExpression(value)) {
    const outcome = evaluate(value, knowledge);
    return outcome === null ? value : { kind: "Primitive", value: outcome };
  }
  const values = getPlaceValues(value, knowledge);
  const [onlyValue] = values ?? [];
  return values?.length === 1 && onlyValue?.kind === "Literal"
    ? { kind: "Primitive", value: onlyValue.value }
    : value;
};

const splitEquality = (value: BinaryExpressionValue): [SymbolicValue, SymbolicValue] =>
  value.left.kind === "Primitive" ? [value.right, value.left] : [value.left, value.right];

const evaluateEquality = (value: BinaryExpressionValue, knowledge: Knowledge): boolean | null => {
  const isNegated = NEGATED_EQUALITY_OPERATORS.has(value.operator);
  const [placeSide, literalSide] = splitEquality(value);
  if (literalSide.kind !== "Primitive") return null;
  const values = getPlaceValues(placeSide, knowledge);
  if (!values) return null;
  const matchCount = values.filter((candidate) =>
    isEqualToLiteral(candidate, literalSide.value, value.operator),
  ).length;
  const canAnyEqual = values.some((candidate) => canTypeEqualLiteral(candidate, literalSide.value));
  if (matchCount === values.length) return !isNegated;
  if (matchCount === 0 && !canAnyEqual) return isNegated;
  return null;
};

const evaluateTruthiness = (values: AbstractValue[]): boolean | null => {
  if (values.length === 0) return null;
  const truthiness = values.map(getTruthiness);
  if (truthiness.every((candidate) => candidate === "truthy")) return true;
  if (truthiness.every((candidate) => candidate === "falsy")) return false;
  return null;
};

/**
 * Decides `value` as a test under `knowledge`: `true`, `false`, or `null` when both are
 * still possible.
 */
export const evaluate = (value: SymbolicValue, knowledge: Knowledge): boolean | null => {
  const fact = knowledge.facts.get(formatSymbolicValue(value));
  if (fact) return fact.outcome;
  switch (value.kind) {
    case "Binding": {
      const values = getPlaceValues(value, knowledge);
      return values ? evaluateTruthiness(values) : null;
    }
    case "UnaryExpression": {
      if (value.operator !== "!") return null;
      const operand = evaluate(value.value, knowledge);
      return operand === null ? null : !operand;
    }
    case "BinaryExpression": {
      const bounded = evaluateBounds(value, knowledge);
      if (bounded !== null) return bounded;
      return EQUALITY_OPERATORS.has(value.operator) ? evaluateEquality(value, knowledge) : null;
    }
    case "Conditional": {
      const test = evaluate(getTestExpression(value.test, value.testKind), knowledge);
      if (test === null) return null;
      return evaluate(test ? value.consequent : value.alternate, knowledge);
    }
    default:
      return getKnownTruthiness(value);
  }
};

const restrictPlace = (
  place: BindingValue,
  knowledge: Knowledge,
  keep: (value: AbstractValue) => boolean,
): Knowledge | null => {
  const values = getPlaceValues(place, knowledge);
  if (!values) return null;
  const restricted = values.filter(keep);
  if (restricted.length === 0) return null;
  const next = cloneKnowledge(knowledge);
  next.values.set(getBindingPlaceKey(place), restricted);
  return next;
};

/**
 * Narrows `knowledge` by assuming `value` tests as `outcome`. Returns `null` when that
 * contradicts what is already known.
 */
export const assume = (
  value: SymbolicValue,
  outcome: boolean,
  knowledge: Knowledge,
): Knowledge | null => {
  const evaluated = evaluate(value, knowledge);
  if (evaluated !== null) return evaluated === outcome ? knowledge : null;
  if (value.kind === "UnaryExpression" && value.operator === "!")
    return assume(value.value, !outcome, knowledge);
  if (value.kind === "Binding") {
    const restricted = restrictPlace(
      value,
      knowledge,
      (candidate) => getTruthiness(candidate) !== (outcome ? "falsy" : "truthy"),
    );
    if (restricted) return restricted;
  }
  if (value.kind === "BinaryExpression" && EQUALITY_OPERATORS.has(value.operator)) {
    const isNegated = NEGATED_EQUALITY_OPERATORS.has(value.operator);
    const [placeSide, literalSide] = splitEquality(value);
    if (literalSide.kind === "Primitive" && placeSide.kind === "Binding") {
      const wantsMatch = outcome !== isNegated;
      const restricted = restrictPlace(placeSide, knowledge, (candidate) =>
        isEqualToLiteral(candidate, literalSide.value, value.operator)
          ? wantsMatch
          : !wantsMatch || canTypeEqualLiteral(candidate, literalSide.value),
      );
      if (restricted) return restricted;
    }
  }
  const next = cloneKnowledge(knowledge);
  next.facts.set(formatSymbolicValue(value), { outcome, bindingIds: collectBindingIds(value) });
  const bounds = getBounds(value, outcome);
  if (bounds) {
    next.bounds.push(...bounds);
    if (!areBoundsConsistent(next.bounds)) return null;
  }
  return next;
};

/**
 * Drops every fact and bound about a binding after an update changes it. An update that
 * keeps the array length, like `items.map(...)`, keeps what is known about `.length`.
 */
export const forgetBinding = (
  knowledge: Knowledge,
  bindingId: number,
  keepsLength: boolean,
): void => {
  const lengthAtom = getLengthAtom(bindingId);
  for (const [key, fact] of knowledge.facts) {
    if (!fact.bindingIds.has(bindingId)) continue;
    if (keepsLength && key.includes(LENGTH_SUFFIX)) continue;
    knowledge.facts.delete(key);
  }
  knowledge.bounds = knowledge.bounds.filter((bound) => {
    const mentionsBinding = [bound.left, bound.right].some(
      (atom) => atom === String(bindingId) || atom.startsWith(`${bindingId}.`),
    );
    return (
      !mentionsBinding || (keepsLength && (bound.left === lengthAtom || bound.right === lengthAtom))
    );
  });
};

export const dedupeValues = (values: AbstractValue[]): AbstractValue[] => [
  ...new Map(values.map((value) => [formatAbstractValue(value), value])).values(),
];

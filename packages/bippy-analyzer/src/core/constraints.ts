import type {
  AbstractValue,
  BinaryExpressionValue,
  BindingValue,
  Place,
  SymbolicValue,
} from "./types";
import { canTypeEqualLiteral, isEqualToLiteral } from "./utils/checks";
import { formatAbstractValue } from "./format";
import { getValueKey } from "./utils/value-key";
import { PlaceMap, getPlaceKey, getValuePlace, isSamePlace } from "./utils/place";
import {
  getKnownTruthiness,
  getNegatedOperator,
  getTestExpression,
  getTruthiness,
} from "./utils/truthiness";
import { forEachSymbolicValue } from "./utils/traverse";

const CONSTANT_KEY = "#";
const LENGTH_FIELD = "length";
export const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
const NEGATED_EQUALITY_OPERATORS = new Set(["!==", "!="]);
const BOUND_OPERATORS = new Set(["<", "<=", ">", ">=", "===", "=="]);
const BOOLEAN_OPERATORS = new Set([...EQUALITY_OPERATORS, "<", "<=", ">", ">="]);

/** `left - right <= constant` (`<` when strict); a null atom is the constant zero. */
export interface Bound {
  left: Place | null;
  right: Place | null;
  constant: number;
  isStrict: boolean;
}

interface LinearTerm {
  atom: Place | null;
  constant: number;
}

interface Distance {
  weight: number;
  isStrict: boolean;
}

interface Assumption {
  outcome: boolean;
  places: Place[];
}

export interface Constraints {
  values: PlaceMap<AbstractValue[]>;
  assumptions: Map<string, Assumption>;
  bounds: Bound[];
  /** Shared across clones: for a union-typed binding, the values each member gives a field. */
  memberCases: PlaceMap<AbstractValue[][]>;
  /** By binding id, the union members still possible; every member when absent. */
  members: Map<number, number[]>;
}

export const cloneConstraints = (constraints: Constraints): Constraints => ({
  values: new PlaceMap(constraints.values),
  assumptions: new Map(constraints.assumptions),
  bounds: [...constraints.bounds],
  memberCases: constraints.memberCases,
  members: new Map(constraints.members),
});

export const getLengthAtom = (bindingId: number): Place => ({ bindingId, path: [LENGTH_FIELD] });

const getAtomKey = (atom: Place | null): string => (atom ? getPlaceKey(atom) : CONSTANT_KEY);

const collectPlaces = (value: SymbolicValue): Place[] => {
  const places: Place[] = [];
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding") places.push(getValuePlace(part));
  });
  return places;
};

const getLinearTerm = (value: SymbolicValue): LinearTerm | null => {
  if (value.kind === "Primitive")
    return typeof value.value === "number" ? { atom: null, constant: value.value } : null;
  if (value.kind === "Binding") return { atom: getValuePlace(value), constant: 0 };
  if (
    value.kind === "UnaryExpression" &&
    value.operator === "-" &&
    value.value.kind === "Primitive" &&
    typeof value.value.value === "number"
  ) {
    return { atom: null, constant: -value.value.value };
  }
  if (value.kind === "BinaryExpression" && (value.operator === "+" || value.operator === "-")) {
    const left = getLinearTerm(value.left);
    const right = getLinearTerm(value.right);
    if (!left || !right) return null;
    const sign = value.operator === "+" ? 1 : -1;
    if (right.atom === null)
      return { atom: left.atom, constant: left.constant + sign * right.constant };
    if (left.atom === null && sign === 1)
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
  if (!left || !right || (left.atom === null && right.atom === null)) return null;
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

// Floyd–Warshall: inconsistent exactly when some atom has a negative cycle to itself.
const areBoundsConsistent = (bounds: Bound[]): boolean => {
  const lengthBounds = bounds
    .flatMap((bound) => [bound.left, bound.right])
    .filter((atom) => atom?.path.at(-1) === LENGTH_FIELD)
    .map((atom): Bound => ({ left: null, right: atom, constant: 0, isStrict: false }));
  const allBounds = [...bounds, ...lengthBounds];
  const atoms = [
    ...new Set([
      CONSTANT_KEY,
      ...allBounds.flatMap((bound) => [getAtomKey(bound.left), getAtomKey(bound.right)]),
    ]),
  ];
  const atomIndices = new Map(atoms.map((atom, index) => [atom, index]));
  const distances = atoms.map((_row, rowIndex) =>
    atoms.map((_column, columnIndex): Distance => ({
      weight: rowIndex === columnIndex ? 0 : Infinity,
      isStrict: false,
    })),
  );
  const getIndex = (atom: Place | null): number => {
    const index = atomIndices.get(getAtomKey(atom));
    if (index === undefined) throw new Error(`Unindexed bound atom ${getAtomKey(atom)}`);
    return index;
  };
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

const evaluateBounds = (value: SymbolicValue, constraints: Constraints): boolean | null => {
  if (constraints.bounds.length === 0) return null;
  const whenTrue = getBounds(value, true);
  const whenFalse = getBounds(value, false);
  if (whenTrue && !areBoundsConsistent([...constraints.bounds, ...whenTrue])) return false;
  if (whenFalse && !areBoundsConsistent([...constraints.bounds, ...whenFalse])) return true;
  return null;
};

const getPlaceValues = (value: SymbolicValue, constraints: Constraints): AbstractValue[] | null =>
  value.kind === "Binding" ? (constraints.values.get(getValuePlace(value)) ?? null) : null;

const isBooleanExpression = (value: SymbolicValue): boolean =>
  (value.kind === "BinaryExpression" && BOOLEAN_OPERATORS.has(value.operator)) ||
  (value.kind === "UnaryExpression" && value.operator === "!");

export const resolveLiteral = (value: SymbolicValue, constraints: Constraints): SymbolicValue => {
  if (isBooleanExpression(value)) {
    const outcome = evaluate(value, constraints);
    return outcome === null ? value : { kind: "Primitive", value: outcome };
  }
  const values = getPlaceValues(value, constraints);
  const [onlyValue] = values ?? [];
  return values?.length === 1 && onlyValue?.kind === "Literal"
    ? { kind: "Primitive", value: onlyValue.value }
    : value;
};

const splitEquality = (value: BinaryExpressionValue): [SymbolicValue, SymbolicValue] =>
  value.left.kind === "Primitive" ? [value.right, value.left] : [value.left, value.right];

const evaluateEquality = (
  value: BinaryExpressionValue,
  constraints: Constraints,
): boolean | null => {
  const isNegated = NEGATED_EQUALITY_OPERATORS.has(value.operator);
  const [placeSide, literalSide] = splitEquality(value);
  if (literalSide.kind !== "Primitive") return null;
  const values = getPlaceValues(placeSide, constraints);
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

export const evaluate = (value: SymbolicValue, constraints: Constraints): boolean | null => {
  const assumption = constraints.assumptions.get(getValueKey(value));
  if (assumption) return assumption.outcome;
  switch (value.kind) {
    case "Binding": {
      const values = getPlaceValues(value, constraints);
      return values ? evaluateTruthiness(values) : null;
    }
    case "UnaryExpression": {
      if (value.operator !== "!") return null;
      const operand = evaluate(value.value, constraints);
      return operand === null ? null : !operand;
    }
    case "BinaryExpression": {
      const bounded = evaluateBounds(value, constraints);
      if (bounded !== null) return bounded;
      return EQUALITY_OPERATORS.has(value.operator) ? evaluateEquality(value, constraints) : null;
    }
    case "Conditional": {
      const test = evaluate(getTestExpression(value), constraints);
      if (test === null) return null;
      return evaluate(test ? value.consequent : value.alternate, constraints);
    }
    default:
      return getKnownTruthiness(value);
  }
};

const getValueKeys = (values: AbstractValue[]): Set<string> =>
  new Set(values.map(formatAbstractValue));

// A value no member names, like a defaulted read's `undefined`, says nothing about the member.
const restrictMembers = (
  constraints: Constraints,
  place: Place,
  restricted: AbstractValue[],
): Constraints | null => {
  const placeCases = constraints.memberCases.get(place);
  if (!placeCases) return constraints;
  const restrictedKeys = getValueKeys(restricted);
  const namedKeys = getValueKeys(placeCases.flat());
  if ([...restrictedKeys].some((key) => !namedKeys.has(key))) return constraints;
  const members = (
    constraints.members.get(place.bindingId) ?? placeCases.map((_, index) => index)
  ).filter((member) =>
    placeCases[member]?.some((value) => restrictedKeys.has(formatAbstractValue(value))),
  );
  if (members.length === 0) return null;
  constraints.members.set(place.bindingId, members);
  for (const [otherPlace, otherCases] of constraints.memberCases) {
    if (otherPlace.bindingId !== place.bindingId || isSamePlace(otherPlace, place)) continue;
    const values = constraints.values.get(otherPlace);
    if (!values) continue;
    const otherNamedKeys = getValueKeys(otherCases.flat());
    const allowedKeys = getValueKeys(members.flatMap((member) => otherCases[member] ?? []));
    const narrowed = values.filter((value) => {
      const key = formatAbstractValue(value);
      return !otherNamedKeys.has(key) || allowedKeys.has(key);
    });
    if (narrowed.length === 0) return null;
    constraints.values.set(otherPlace, narrowed);
  }
  return constraints;
};

const restrictPlace = (
  place: BindingValue,
  constraints: Constraints,
  keep: (value: AbstractValue) => boolean,
): Constraints | null => {
  const values = getPlaceValues(place, constraints);
  if (!values) return null;
  const restricted = values.filter(keep);
  if (restricted.length === 0) return null;
  const next = cloneConstraints(constraints);
  next.values.set(getValuePlace(place), restricted);
  return restrictMembers(next, getValuePlace(place), restricted);
};

// Unknowns print alike, so an assumption about one, keyed by its text, would decide another.
const hasUnknownPart = (value: SymbolicValue): boolean => {
  let hasUnknown = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Unknown") hasUnknown = true;
  });
  return hasUnknown;
};

export const assume = (
  value: SymbolicValue,
  outcome: boolean,
  constraints: Constraints,
): Constraints | null => {
  const evaluated = evaluate(value, constraints);
  if (evaluated !== null) return evaluated === outcome ? constraints : null;
  if (value.kind === "UnaryExpression" && value.operator === "!")
    return assume(value.value, !outcome, constraints);
  if (
    value.kind === "Conditional" &&
    outcome &&
    value.alternate.kind === "Primitive" &&
    !value.alternate.value
  ) {
    const held = assume(getTestExpression(value), true, constraints);
    return held && assume(value.consequent, true, held);
  }
  if (value.kind === "Binding" && getPlaceValues(value, constraints))
    return restrictPlace(
      value,
      constraints,
      (candidate) => getTruthiness(candidate) !== (outcome ? "falsy" : "truthy"),
    );
  if (value.kind === "BinaryExpression" && EQUALITY_OPERATORS.has(value.operator)) {
    const isNegated = NEGATED_EQUALITY_OPERATORS.has(value.operator);
    const [placeSide, literalSide] = splitEquality(value);
    if (
      literalSide.kind === "Primitive" &&
      placeSide.kind === "Binding" &&
      getPlaceValues(placeSide, constraints)
    ) {
      const wantsMatch = outcome !== isNegated;
      return restrictPlace(placeSide, constraints, (candidate) =>
        isEqualToLiteral(candidate, literalSide.value, value.operator)
          ? wantsMatch
          : !wantsMatch || canTypeEqualLiteral(candidate, literalSide.value),
      );
    }
  }
  if (hasUnknownPart(value)) return constraints;
  const next = cloneConstraints(constraints);
  next.assumptions.set(getValueKey(value), {
    outcome,
    places: collectPlaces(value),
  });
  const bounds = getBounds(value, outcome);
  if (bounds) {
    next.bounds.push(...bounds);
    if (!areBoundsConsistent(next.bounds)) return null;
  }
  return next;
};

export const forgetBinding = (
  constraints: Constraints,
  bindingId: number,
  keepsLength: boolean,
): void => {
  const lengthAtom = getLengthAtom(bindingId);
  const isLength = (atom: Place | null): boolean => atom !== null && isSamePlace(atom, lengthAtom);
  constraints.members.delete(bindingId);
  for (const [key, assumption] of constraints.assumptions) {
    const places = assumption.places.filter((place) => place.bindingId === bindingId);
    if (places.length === 0) continue;
    if (keepsLength && places.every(isLength)) continue;
    constraints.assumptions.delete(key);
  }
  constraints.bounds = constraints.bounds.filter((bound) => {
    const mentionsBinding = [bound.left, bound.right].some((atom) => atom?.bindingId === bindingId);
    return !mentionsBinding || (keepsLength && (isLength(bound.left) || isLength(bound.right)));
  });
};

export const dedupeValues = (values: AbstractValue[]): AbstractValue[] => [
  ...new Map(values.map((value) => [formatAbstractValue(value), value])).values(),
];

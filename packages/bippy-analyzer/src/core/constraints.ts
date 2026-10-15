import type {
  AbstractValue,
  BinaryExpressionValue,
  BindingValue,
  BindingPlace,
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

export interface Bound {
  left: BindingPlace | null;
  right: BindingPlace | null;
  maxDifference: number;
  isStrict: boolean;
}

interface LinearTerm {
  atom: BindingPlace | null;
  offset: number;
}

interface Distance {
  weight: number;
  isStrict: boolean;
}

interface Assumption {
  isTrue: boolean;
  places: BindingPlace[];
}

export interface Constraints {
  possibleValues: PlaceMap<AbstractValue[]>;
  assumptions: Map<string, Assumption>;
  bounds: Bound[];
  invariants: Bound[];
  unionMemberValues: PlaceMap<AbstractValue[][]>;
  possibleMembers: Map<number, number[]>;
}

export const cloneConstraints = (constraints: Constraints): Constraints => ({
  possibleValues: constraints.possibleValues.clone(),
  assumptions: new Map(constraints.assumptions),
  bounds: [...constraints.bounds],
  invariants: constraints.invariants,
  unionMemberValues: constraints.unionMemberValues,
  possibleMembers: new Map(constraints.possibleMembers),
});

export const getLengthAtom = (bindingId: number): BindingPlace => ({
  bindingId,
  path: [LENGTH_FIELD],
});

const getAtomKey = (atom: BindingPlace | null): string => (atom ? getPlaceKey(atom) : CONSTANT_KEY);

const collectPlaces = (value: SymbolicValue): BindingPlace[] => {
  const places: BindingPlace[] = [];
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding") places.push(getValuePlace(part));
  });
  return places;
};

const getLinearTerm = (value: SymbolicValue): LinearTerm | null => {
  if (value.kind === "Primitive")
    return typeof value.value === "number" ? { atom: null, offset: value.value } : null;
  if (value.kind === "Binding") return { atom: getValuePlace(value), offset: 0 };
  if (
    value.kind === "UnaryExpression" &&
    value.operator === "-" &&
    value.value.kind === "Primitive" &&
    typeof value.value.value === "number"
  ) {
    return { atom: null, offset: -value.value.value };
  }
  if (value.kind === "BinaryExpression" && (value.operator === "+" || value.operator === "-")) {
    const leftTerm = getLinearTerm(value.left);
    const rightTerm = getLinearTerm(value.right);
    if (!leftTerm || !rightTerm) return null;
    const sign = value.operator === "+" ? 1 : -1;
    if (rightTerm.atom === null)
      return { atom: leftTerm.atom, offset: leftTerm.offset + sign * rightTerm.offset };
    if (leftTerm.atom === null && sign === 1)
      return { atom: rightTerm.atom, offset: leftTerm.offset + rightTerm.offset };
  }
  return null;
};

const getBounds = (value: SymbolicValue, isTrue: boolean): Bound[] | null => {
  if (value.kind !== "BinaryExpression") return null;
  const operator = isTrue ? value.operator : getNegatedOperator(value.operator);
  if (!operator || !BOUND_OPERATORS.has(operator)) return null;
  const leftTerm = getLinearTerm(value.left);
  const rightTerm = getLinearTerm(value.right);
  if (!leftTerm || !rightTerm || (leftTerm.atom === null && rightTerm.atom === null)) return null;
  const offsetDifference = rightTerm.offset - leftTerm.offset;
  const lessThan = (isStrict: boolean): Bound => ({
    left: leftTerm.atom,
    right: rightTerm.atom,
    maxDifference: offsetDifference,
    isStrict,
  });
  const greaterThan = (isStrict: boolean): Bound => ({
    left: rightTerm.atom,
    right: leftTerm.atom,
    maxDifference: -offsetDifference,
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

const createDistanceMatrix = (bounds: Bound[]): Distance[][] => {
  const lengthBounds = bounds
    .flatMap((bound) => [bound.left, bound.right])
    .filter((atom) => atom?.path.at(-1) === LENGTH_FIELD)
    .map((atom): Bound => ({ left: null, right: atom, maxDifference: 0, isStrict: false }));
  const allBounds = [...bounds, ...lengthBounds];
  const atomKeys = [
    ...new Set([
      CONSTANT_KEY,
      ...allBounds.flatMap((bound) => [getAtomKey(bound.left), getAtomKey(bound.right)]),
    ]),
  ];
  const indicesByAtomKey = new Map(atomKeys.map((atomKey, index) => [atomKey, index]));
  const distances = atomKeys.map((_rowKey, rowIndex) =>
    atomKeys.map((_columnKey, columnIndex): Distance => ({
      weight: rowIndex === columnIndex ? 0 : Infinity,
      isStrict: false,
    })),
  );
  const getAtomIndex = (atom: BindingPlace | null): number => {
    const atomIndex = indicesByAtomKey.get(getAtomKey(atom));
    if (atomIndex === undefined) throw new Error(`Unindexed bound atom ${getAtomKey(atom)}`);
    return atomIndex;
  };
  for (const bound of allBounds) {
    const row = distances[getAtomIndex(bound.right)];
    const columnIndex = getAtomIndex(bound.left);
    const boundDistance = { weight: bound.maxDifference, isStrict: bound.isStrict };
    if (isShorter(boundDistance, row[columnIndex])) row[columnIndex] = boundDistance;
  }
  return distances;
};

const relaxThroughEveryAtom = (distances: Distance[][]): void => {
  for (let middle = 0; middle < distances.length; middle++) {
    for (let from = 0; from < distances.length; from++) {
      for (let to = 0; to < distances.length; to++) {
        const toMiddle = distances[from][middle];
        const fromMiddle = distances[middle][to];
        const throughMiddle = {
          weight: toMiddle.weight + fromMiddle.weight,
          isStrict: toMiddle.isStrict || fromMiddle.isStrict,
        };
        if (isShorter(throughMiddle, distances[from][to])) distances[from][to] = throughMiddle;
      }
    }
  }
};

const areBoundsConsistent = (bounds: Bound[]): boolean => {
  const distances = createDistanceMatrix(bounds);
  relaxThroughEveryAtom(distances);
  return distances.every((row, atomIndex) => {
    const cycleDistance = row[atomIndex];
    return !(cycleDistance.weight < 0 || (cycleDistance.weight === 0 && cycleDistance.isStrict));
  });
};

const evaluateBounds = (value: SymbolicValue, constraints: Constraints): boolean | null => {
  const bounds = [...constraints.invariants, ...constraints.bounds];
  if (bounds.length === 0) return null;
  const whenTrue = getBounds(value, true);
  const whenFalse = getBounds(value, false);
  if (whenTrue && !areBoundsConsistent([...bounds, ...whenTrue])) return false;
  if (whenFalse && !areBoundsConsistent([...bounds, ...whenFalse])) return true;
  return null;
};

const getPossibleValues = (
  value: SymbolicValue,
  constraints: Constraints,
): AbstractValue[] | null =>
  value.kind === "Binding" ? (constraints.possibleValues.get(getValuePlace(value)) ?? null) : null;

const isBooleanExpression = (value: SymbolicValue): boolean =>
  (value.kind === "BinaryExpression" && BOOLEAN_OPERATORS.has(value.operator)) ||
  (value.kind === "UnaryExpression" && value.operator === "!");

export const resolveLiteral = (value: SymbolicValue, constraints: Constraints): SymbolicValue => {
  if (isBooleanExpression(value)) {
    const outcome = evaluateCondition(value, constraints);
    return outcome === null ? value : { kind: "Primitive", value: outcome };
  }
  const placeValues = getPossibleValues(value, constraints);
  const [onlyValue] = placeValues ?? [];
  return placeValues?.length === 1 && onlyValue?.kind === "Literal"
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
  const placeValues = getPossibleValues(placeSide, constraints);
  if (!placeValues) return null;
  const matchCount = placeValues.filter((candidate) =>
    isEqualToLiteral(candidate, literalSide.value, value.operator),
  ).length;
  const canAnyEqual = placeValues.some((candidate) =>
    canTypeEqualLiteral(candidate, literalSide.value),
  );
  if (matchCount === placeValues.length) return !isNegated;
  if (matchCount === 0 && !canAnyEqual) return isNegated;
  return null;
};

const evaluateTruthiness = (placeValues: AbstractValue[]): boolean | null => {
  if (placeValues.length === 0) return null;
  const truthiness = placeValues.map(getTruthiness);
  if (truthiness.every((candidate) => candidate === "truthy")) return true;
  if (truthiness.every((candidate) => candidate === "falsy")) return false;
  return null;
};

export const evaluateCondition = (
  value: SymbolicValue,
  constraints: Constraints,
): boolean | null => {
  const assumption = constraints.assumptions.get(getValueKey(value));
  if (assumption) return assumption.isTrue;
  switch (value.kind) {
    case "Binding": {
      const placeValues = getPossibleValues(value, constraints);
      return placeValues ? evaluateTruthiness(placeValues) : null;
    }
    case "UnaryExpression": {
      if (value.operator !== "!") return null;
      const operand = evaluateCondition(value.value, constraints);
      return operand === null ? null : !operand;
    }
    case "BinaryExpression": {
      const bounded = evaluateBounds(value, constraints);
      if (bounded !== null) return bounded;
      return EQUALITY_OPERATORS.has(value.operator) ? evaluateEquality(value, constraints) : null;
    }
    case "Conditional": {
      const test = evaluateCondition(getTestExpression(value), constraints);
      if (test === null) return null;
      return evaluateCondition(test ? value.consequent : value.alternate, constraints);
    }
    default:
      return getKnownTruthiness(value);
  }
};

const getAbstractValueKeys = (values: AbstractValue[]): Set<string> =>
  new Set(values.map(formatAbstractValue));

const narrowUnionMembers = (
  constraints: Constraints,
  place: BindingPlace,
  narrowedValues: AbstractValue[],
): Constraints | null => {
  const memberValues = constraints.unionMemberValues.get(place);
  if (!memberValues) return constraints;
  const narrowedKeys = getAbstractValueKeys(narrowedValues);
  const memberValueKeys = getAbstractValueKeys(memberValues.flat());
  if ([...narrowedKeys].some((valueKey) => !memberValueKeys.has(valueKey))) return constraints;
  const allMembers = memberValues.map((_values, memberIndex) => memberIndex);
  const possibleMembers = (constraints.possibleMembers.get(place.bindingId) ?? allMembers).filter(
    (memberIndex) =>
      memberValues[memberIndex]?.some((value) => narrowedKeys.has(formatAbstractValue(value))),
  );
  if (possibleMembers.length === 0) return null;
  constraints.possibleMembers.set(place.bindingId, possibleMembers);
  for (const [siblingPlace, siblingMemberValues] of constraints.unionMemberValues) {
    if (siblingPlace.bindingId !== place.bindingId || isSamePlace(siblingPlace, place)) continue;
    const siblingValues = constraints.possibleValues.get(siblingPlace);
    if (!siblingValues) continue;
    const siblingValueKeys = getAbstractValueKeys(siblingMemberValues.flat());
    const allowedKeys = getAbstractValueKeys(
      possibleMembers.flatMap((memberIndex) => siblingMemberValues[memberIndex] ?? []),
    );
    const narrowedSiblingValues = siblingValues.filter((value) => {
      const valueKey = formatAbstractValue(value);
      return !siblingValueKeys.has(valueKey) || allowedKeys.has(valueKey);
    });
    if (narrowedSiblingValues.length === 0) return null;
    constraints.possibleValues.set(siblingPlace, narrowedSiblingValues);
  }
  return constraints;
};

const narrowPlace = (
  bindingValue: BindingValue,
  constraints: Constraints,
  isKept: (value: AbstractValue) => boolean,
): Constraints | null => {
  const placeValues = getPossibleValues(bindingValue, constraints);
  if (!placeValues) return null;
  const narrowedValues = placeValues.filter(isKept);
  if (narrowedValues.length === 0) return null;
  const narrowed = cloneConstraints(constraints);
  const place = getValuePlace(bindingValue);
  narrowed.possibleValues.set(place, narrowedValues);
  return narrowUnionMembers(narrowed, place, narrowedValues);
};

const hasUnknownPart = (value: SymbolicValue): boolean => {
  let hasUnknown = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Unknown") hasUnknown = true;
  });
  return hasUnknown;
};

export const assumeCondition = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  const evaluated = evaluateCondition(value, constraints);
  if (evaluated !== null) return evaluated === isTrue ? constraints : null;
  if (value.kind === "UnaryExpression" && value.operator === "!")
    return assumeCondition(value.value, !isTrue, constraints);
  if (
    value.kind === "Conditional" &&
    isTrue &&
    value.alternate.kind === "Primitive" &&
    !value.alternate.value
  ) {
    const withTest = assumeCondition(getTestExpression(value), true, constraints);
    return withTest && assumeCondition(value.consequent, true, withTest);
  }
  if (value.kind === "Binding" && getPossibleValues(value, constraints))
    return narrowPlace(
      value,
      constraints,
      (candidate) => getTruthiness(candidate) !== (isTrue ? "falsy" : "truthy"),
    );
  if (value.kind === "BinaryExpression" && EQUALITY_OPERATORS.has(value.operator))
    return assumeEquality(value, isTrue, constraints);
  return assumeOpaqueCondition(value, isTrue, constraints);
};

const assumeEquality = (
  value: BinaryExpressionValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  const [placeSide, literalSide] = splitEquality(value);
  if (
    literalSide.kind !== "Primitive" ||
    placeSide.kind !== "Binding" ||
    !getPossibleValues(placeSide, constraints)
  )
    return assumeOpaqueCondition(value, isTrue, constraints);
  const wantsMatch = isTrue !== NEGATED_EQUALITY_OPERATORS.has(value.operator);
  return narrowPlace(placeSide, constraints, (candidate) =>
    isEqualToLiteral(candidate, literalSide.value, value.operator)
      ? wantsMatch
      : !wantsMatch || canTypeEqualLiteral(candidate, literalSide.value),
  );
};

const assumeOpaqueCondition = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  if (hasUnknownPart(value)) return constraints;
  const assumed = cloneConstraints(constraints);
  assumed.assumptions.set(getValueKey(value), {
    isTrue,
    places: collectPlaces(value),
  });
  const assumedBounds = getBounds(value, isTrue);
  if (assumedBounds) {
    assumed.bounds.push(...assumedBounds);
    if (!areBoundsConsistent([...assumed.invariants, ...assumed.bounds])) return null;
  }
  return assumed;
};

export const forgetBinding = (
  constraints: Constraints,
  bindingId: number,
  shouldKeepLength: boolean,
): void => {
  const lengthAtom = getLengthAtom(bindingId);
  const isLength = (atom: BindingPlace | null): boolean =>
    atom !== null && isSamePlace(atom, lengthAtom);
  constraints.possibleMembers.delete(bindingId);
  for (const [assumptionKey, assumption] of constraints.assumptions) {
    const bindingPlaces = assumption.places.filter((place) => place.bindingId === bindingId);
    if (bindingPlaces.length === 0) continue;
    if (shouldKeepLength && bindingPlaces.every(isLength)) continue;
    constraints.assumptions.delete(assumptionKey);
  }
  constraints.bounds = constraints.bounds.filter((bound) => {
    const mentionsBinding = [bound.left, bound.right].some((atom) => atom?.bindingId === bindingId);
    return (
      !mentionsBinding || (shouldKeepLength && (isLength(bound.left) || isLength(bound.right)))
    );
  });
};

export const dedupeAbstractValues = (values: AbstractValue[]): AbstractValue[] => [
  ...new Map(values.map((value) => [formatAbstractValue(value), value])).values(),
];

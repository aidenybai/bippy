import { createHash } from "node:crypto";
import type {
  AbstractValue,
  BinaryExpressionValue,
  BinaryOperator,
  BindingValue,
  BindingPlace,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
} from "./types";
import { canTypeEqualLiteral } from "./utils/can-type-equal-literal";
import { isEqualToLiteral } from "./utils/is-equal-to-literal";
import { formatAbstractValue } from "./format";
import { getValueKey } from "./utils/get-value-key";
import { PlaceMap } from "./utils/place-map";
import { getPlaceKey } from "./utils/get-place-key";
import { getValuePlace } from "./utils/get-value-place";
import { isSamePlace } from "./utils/is-same-place";
import { foldBinary } from "./symbolic-values";
import { getKnownTruthiness } from "./utils/get-known-truthiness";
import { isBooleanExpression } from "./utils/is-boolean-expression";
import { isNullish } from "./utils/is-nullish";
import { getNegatedOperator } from "./utils/get-negated-operator";
import { getTestExpression } from "./utils/get-test-expression";
import { getTruthiness } from "./utils/get-truthiness";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";

const CONSTANT_KEY = "#";
const LENGTH_FIELD = "length";
export const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
const NEGATED_EQUALITY_OPERATORS = new Set(["!==", "!="]);
const STRICT_EQUALITY_OPERATORS = new Set(["===", "!=="]);
const BOUND_OPERATORS = new Set(["<", "<=", ">", ">=", "===", "=="]);

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
  hasUnknown: boolean;
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

const formatPlaceEntries = <Value>(
  placeMap: PlaceMap<Value>,
  formatValue: (value: Value) => string,
): string =>
  [...placeMap]
    .map(([place, value]) => `${getPlaceKey(place)}=${formatValue(value)}`)
    .sort()
    .join(";");

const formatAbstractValues = (values: AbstractValue[]): string =>
  values.map((value) => `${value.kind}:${formatAbstractValue(value)}`).join("|");

const formatBound = (bound: Bound): string =>
  `${getAtomKey(bound.left)}-${getAtomKey(bound.right)}${bound.isStrict ? "<" : "<="}${bound.maxDifference}`;

const formatAssumption = ([key, assumption]: [string, Assumption]): string =>
  `${key}=${assumption.isTrue}:${assumption.places.map(getPlaceKey).join(",")}`;

const serializeConstraints = (constraints: Constraints): string =>
  [
    formatPlaceEntries(constraints.possibleValues, formatAbstractValues),
    [...constraints.assumptions].map(formatAssumption).sort().join(";"),
    constraints.bounds.map(formatBound).sort().join(";"),
    constraints.invariants.map(formatBound).sort().join(";"),
    formatPlaceEntries(constraints.unionMemberValues, (members) =>
      members.map(formatAbstractValues).join("/"),
    ),
    [...constraints.possibleMembers]
      .map(([bindingId, members]) => `${bindingId}=${members.join(",")}`)
      .sort()
      .join(";"),
  ].join("\n");

export const getConstraintsKey = (constraints: Constraints): string =>
  createHash("sha256").update(serializeConstraints(constraints)).digest("base64");

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

const compareWithZero = (
  value: BindingValue,
  operator: "<" | ">",
  constraints: Constraints,
): boolean | null =>
  evaluateBounds(
    { kind: "BinaryExpression", operator, left: value, right: { kind: "Primitive", value: 0 } },
    constraints,
  );

const evaluateNonZero = (value: BindingValue, constraints: Constraints): boolean | null => {
  const place = getValuePlace(value);
  const isBounded = [...constraints.invariants, ...constraints.bounds].some((bound) =>
    [bound.left, bound.right].some((atom) => atom !== null && isSamePlace(atom, place)),
  );
  if (!isBounded) return null;
  const isPositive = compareWithZero(value, ">", constraints);
  const isNegative = compareWithZero(value, "<", constraints);
  if (isPositive || isNegative) return true;
  return isPositive === false && isNegative === false ? false : null;
};

export const getPossibleValues = (
  value: SymbolicValue,
  constraints: Constraints,
): AbstractValue[] | null =>
  value.kind === "Binding" ? (constraints.possibleValues.get(getValuePlace(value)) ?? null) : null;

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

const distributeComparison = (value: SymbolicValue): ConditionalValue | null => {
  if (value.kind !== "BinaryExpression" || !EQUALITY_OPERATORS.has(value.operator)) return null;
  const { operator, left, right } = value;
  if (left.kind === "Conditional" && right.kind === "Primitive")
    return {
      ...left,
      consequent: foldBinary(operator, left.consequent, right),
      alternate: foldBinary(operator, left.alternate, right),
    };
  if (right.kind === "Conditional" && left.kind === "Primitive")
    return {
      ...right,
      consequent: foldBinary(operator, left, right.consequent),
      alternate: foldBinary(operator, left, right.alternate),
    };
  return null;
};

const evaluateEquality = (
  value: BinaryExpressionValue,
  constraints: Constraints,
): boolean | null => {
  const isNegated = NEGATED_EQUALITY_OPERATORS.has(value.operator);
  const [placeSide, literalSide] = splitEquality(value);
  if (literalSide.kind !== "Primitive") return null;
  if (
    STRICT_EQUALITY_OPERATORS.has(value.operator) &&
    differsInTruthiness(placeSide, literalSide.value, constraints)
  )
    return isNegated;
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

const differsInTruthiness = (
  value: SymbolicValue,
  literal: PrimitiveValue,
  constraints: Constraints,
): boolean => {
  const truthiness = evaluateCondition(value, constraints);
  return truthiness !== null && truthiness !== Boolean(literal);
};

const evaluateTruthiness = (placeValues: AbstractValue[]): boolean | null => {
  if (placeValues.length === 0) return null;
  const truthiness = placeValues.map(getTruthiness);
  if (truthiness.every((candidate) => candidate === "truthy")) return true;
  if (truthiness.every((candidate) => candidate === "falsy")) return false;
  return null;
};

const getEqualityCounterpart = (value: SymbolicValue): BinaryExpressionValue | null => {
  if (value.kind !== "BinaryExpression" || !EQUALITY_OPERATORS.has(value.operator)) return null;
  const operator = getNegatedOperator(value.operator);
  return operator ? { ...value, operator } : null;
};

export const evaluateCondition = (
  value: SymbolicValue,
  constraints: Constraints,
): boolean | null => {
  const assumption = constraints.assumptions.get(getValueKey(value));
  if (assumption) return assumption.isTrue;
  const counterpart = getEqualityCounterpart(value);
  const counterpartAssumption =
    counterpart && constraints.assumptions.get(getValueKey(counterpart));
  if (counterpartAssumption) return !counterpartAssumption.isTrue;
  switch (value.kind) {
    case "Binding": {
      const placeValues = getPossibleValues(value, constraints);
      return (
        (placeValues && evaluateTruthiness(placeValues)) ?? evaluateNonZero(value, constraints)
      );
    }
    case "UnaryExpression": {
      if (value.operator !== "!") return null;
      const operand = evaluateCondition(value.value, constraints);
      return operand === null ? null : !operand;
    }
    case "BinaryExpression": {
      const distributed = distributeComparison(value);
      if (distributed) return evaluateCondition(distributed, constraints);
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
  narrowValue: (value: AbstractValue) => AbstractValue[],
): Constraints | null => {
  const placeValues = getPossibleValues(bindingValue, constraints);
  if (!placeValues) return null;
  const narrowedValues = dedupeAbstractValues(placeValues.flatMap(narrowValue));
  if (narrowedValues.length === 0) return null;
  const narrowed = cloneConstraints(constraints);
  const place = getValuePlace(bindingValue);
  narrowed.possibleValues.set(place, narrowedValues);
  return narrowUnionMembers(narrowed, place, narrowedValues);
};

export const hasUnknownPart = (value: SymbolicValue): boolean => {
  let hasUnknown = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Unknown") hasUnknown = true;
  });
  return hasUnknown;
};

const hasNullishAncestor = (place: BindingPlace, possibleValues: PlaceMap<AbstractValue[]>) =>
  place.path.some((_segment, length) => {
    const ancestorValues = possibleValues.get({
      bindingId: place.bindingId,
      path: place.path.slice(0, length),
    });
    return (
      ancestorValues !== undefined &&
      ancestorValues.length > 0 &&
      ancestorValues.every((value) => value.kind === "Literal" && isNullish(value.value))
    );
  });

const createAssumption = (value: SymbolicValue, isTrue: boolean): Assumption => ({
  isTrue,
  places: collectPlaces(value),
  hasUnknown: hasUnknownPart(value),
});

export const forgetUnknownAssumptions = (constraints: Constraints): void => {
  for (const [assumptionKey, assumption] of constraints.assumptions)
    if (assumption.hasUnknown) constraints.assumptions.delete(assumptionKey);
};

const joinPlaceValues = (
  left: PlaceMap<AbstractValue[]>,
  right: PlaceMap<AbstractValue[]>,
): PlaceMap<AbstractValue[]> =>
  new PlaceMap(
    [...left].flatMap(([place, leftValues]): Array<[BindingPlace, AbstractValue[]]> => {
      const rightValues = right.get(place);
      if (!rightValues) return [];
      if (hasNullishAncestor(place, left)) return [[place, rightValues]];
      if (hasNullishAncestor(place, right)) return [[place, leftValues]];
      return [
        [
          place,
          rightValues === leftValues
            ? leftValues
            : dedupeAbstractValues([...leftValues, ...rightValues]),
        ],
      ];
    }),
  );

const joinConstraints = (left: Constraints, right: Constraints): Constraints => {
  const rightBoundKeys = new Set(right.bounds.map(formatBound));
  return {
    possibleValues: joinPlaceValues(left.possibleValues, right.possibleValues),
    assumptions: new Map(
      [...left.assumptions].filter(
        ([key, assumption]) => right.assumptions.get(key)?.isTrue === assumption.isTrue,
      ),
    ),
    bounds: left.bounds.filter((bound) => rightBoundKeys.has(formatBound(bound))),
    invariants: left.invariants,
    unionMemberValues: left.unionMemberValues,
    possibleMembers: new Map(
      [...left.possibleMembers].flatMap(([bindingId, members]): Array<[number, number[]]> => {
        const rightMembers = right.possibleMembers.get(bindingId);
        return rightMembers ? [[bindingId, [...new Set([...members, ...rightMembers])]]] : [];
      }),
    ),
  };
};

type AssumptionMemo = Map<Constraints, Map<string, Constraints | null>>;

const assumeConditional = (
  value: ConditionalValue,
  isTrue: boolean,
  constraints: Constraints,
  memo: AssumptionMemo,
): Constraints | null => {
  const test = getTestExpression(value);
  const whenTrue = assumeMemoized(test, true, constraints, memo);
  const whenFalse = assumeMemoized(test, false, constraints, memo);
  const consequent = whenTrue && assumeMemoized(value.consequent, isTrue, whenTrue, memo);
  const alternate = whenFalse && assumeMemoized(value.alternate, isTrue, whenFalse, memo);
  const joined =
    consequent && alternate ? joinConstraints(consequent, alternate) : (consequent ?? alternate);
  if (!joined) return joined;
  const assumed = cloneConstraints(joined);
  assumed.assumptions.set(getValueKey(value), createAssumption(value, isTrue));
  return assumed;
};

const assumeDecidedArm = (
  value: ConditionalValue,
  isTrue: boolean,
  constraints: Constraints,
  memo: AssumptionMemo,
): Constraints | null => {
  const test = evaluateCondition(getTestExpression(value), constraints);
  if (test === null) return constraints;
  return assumeMemoized(test ? value.consequent : value.alternate, isTrue, constraints, memo);
};

const assumeMemoized = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
  memo: AssumptionMemo,
): Constraints | null => {
  const assumedByKey = memo.get(constraints) ?? new Map<string, Constraints | null>();
  memo.set(constraints, assumedByKey);
  const assumptionKey = `${isTrue}:${getValueKey(value)}`;
  if (assumedByKey.has(assumptionKey)) return assumedByKey.get(assumptionKey) ?? null;
  const assumed = assumeUncached(value, isTrue, constraints, memo);
  assumedByKey.set(assumptionKey, assumed);
  return assumed;
};

const assumeUncached = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
  memo: AssumptionMemo,
): Constraints | null => {
  const evaluated = evaluateCondition(value, constraints);
  if (evaluated !== null) {
    if (evaluated !== isTrue) return null;
    return value.kind === "Conditional"
      ? assumeDecidedArm(value, isTrue, constraints, memo)
      : constraints;
  }
  if (value.kind === "UnaryExpression" && value.operator === "!")
    return assumeMemoized(value.value, !isTrue, constraints, memo);
  if (value.kind === "Conditional") return assumeConditional(value, isTrue, constraints, memo);
  const distributed = distributeComparison(value);
  if (distributed) return assumeConditional(distributed, isTrue, constraints, memo);
  if (value.kind === "Binding" && getPossibleValues(value, constraints))
    return assumeByNarrowing(value, isTrue, value, constraints, (candidate) =>
      narrowTruthiness(candidate, isTrue),
    );
  if (value.kind === "BinaryExpression" && EQUALITY_OPERATORS.has(value.operator))
    return assumeEquality(value, isTrue, constraints);
  return assumeOpaqueCondition(value, isTrue, constraints);
};

export const assumeCondition = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => assumeMemoized(value, isTrue, constraints, new Map());

const assumeEquality = (
  value: BinaryExpressionValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  const [placeSide, literalSide] = splitEquality(value);
  if (literalSide.kind !== "Primitive" || placeSide.kind !== "Binding")
    return assumeOpaqueCondition(value, isTrue, constraints);
  const wantsMatch = isTrue !== NEGATED_EQUALITY_OPERATORS.has(value.operator);
  if (!getPossibleValues(placeSide, constraints)) {
    const assumed = assumeOpaqueCondition(value, isTrue, constraints);
    return assumed && wantsMatch && STRICT_EQUALITY_OPERATORS.has(value.operator)
      ? withExactValue(assumed, placeSide, literalSide.value)
      : assumed;
  }
  return assumeByNarrowing(value, isTrue, placeSide, constraints, (candidate) =>
    narrowEquality(candidate, literalSide.value, value.operator, wantsMatch),
  );
};

const assumeByNarrowing = (
  value: SymbolicValue,
  isTrue: boolean,
  bindingValue: BindingValue,
  constraints: Constraints,
  narrowValue: (candidate: AbstractValue) => AbstractValue[],
): Constraints | null => {
  const narrowed = narrowPlace(bindingValue, constraints, narrowValue);
  if (!narrowed || evaluateCondition(value, narrowed) !== null) return narrowed;
  return assumeOpaqueCondition(value, isTrue, narrowed);
};

const withExactValue = (
  constraints: Constraints,
  bindingValue: BindingValue,
  literal: PrimitiveValue,
): Constraints => {
  const assumed = cloneConstraints(constraints);
  assumed.possibleValues.set(getValuePlace(bindingValue), [{ kind: "Literal", value: literal }]);
  return assumed;
};

const narrowTruthiness = (value: AbstractValue, isTruthy: boolean): AbstractValue[] => {
  const truthiness = getTruthiness(value);
  if (truthiness !== "either") return truthiness === (isTruthy ? "truthy" : "falsy") ? [value] : [];
  if (!isTruthy && value.kind === "Type" && value.primitive === "string")
    return [{ kind: "Literal", value: "" }];
  return [value];
};

const narrowEquality = (
  value: AbstractValue,
  literal: PrimitiveValue,
  operator: BinaryOperator,
  wantsMatch: boolean,
): AbstractValue[] => {
  if (isEqualToLiteral(value, literal, operator)) return wantsMatch ? [value] : [];
  if (!canTypeEqualLiteral(value, literal)) return wantsMatch ? [] : [value];
  if (wantsMatch && value.kind === "Type" && value.primitive === typeof literal)
    return [{ kind: "Literal", value: literal }];
  return [value];
};

const assumeOpaqueCondition = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  const assumed = cloneConstraints(constraints);
  assumed.assumptions.set(getValueKey(value), createAssumption(value, isTrue));
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

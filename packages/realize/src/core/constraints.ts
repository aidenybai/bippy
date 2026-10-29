import type {
  AbstractValue,
  BinaryExpressionValue,
  BinaryOperator,
  BindingValue,
  BindingPlace,
  ConditionalValue,
  DerivedCall,
  Domain,
  PrimitiveValue,
  SymbolicValue,
} from "./types";
import { canTypeEqualLiteral } from "./utils/can-type-equal-literal";
import {
  addBounds,
  evaluateBounds,
  evaluateNonZero,
  getAtomKey,
  getBoundGraph,
  getBounds,
  isConsistent,
  LENGTH_FIELD,
} from "./bound-graph";
import type { Bound, BoundGraph } from "./bound-graph";
import {
  COMPARISON_OPERATORS,
  EQUALITY_OPERATORS,
  MIRRORED_OPERATORS,
  NEGATED_EQUALITY_OPERATORS,
  ORDER_OPERATORS,
  STRICT_EQUALITY_OPERATORS,
} from "./comparison-operators";
import { dedupeAbstractValues } from "./abstract-values";
import { isEqualToLiteral } from "./utils/is-equal-to-literal";
import { formatAbstractValue } from "./format";
import { getValueKey } from "./utils/get-value-key";
import { isPlacePrefix } from "./utils/is-place-prefix";
import { PlaceMap } from "./utils/place-map";
import { getPlaceKey } from "./utils/get-place-key";
import { getValuePlace } from "./utils/get-value-place";
import { isSamePlace } from "./utils/is-same-place";
import { foldBinary, foldUnary, hasUnknownPart } from "./symbolic-values";
import {
  applyPureFunction,
  applyPureFunctionToCases,
  isPureFunction,
} from "./utils/pure-functions";
import { getKnownTruthiness } from "./utils/get-known-truthiness";
import { isBooleanExpression } from "./utils/is-boolean-expression";
import { isNullish } from "./utils/is-nullish";
import { isNullishCase } from "./utils/is-nullish-case";
import { getNegatedOperator } from "./utils/get-negated-operator";
import { getTestExpression } from "./utils/get-test-expression";
import { getTruthiness } from "./utils/get-truthiness";
import { getTypeofNames } from "./utils/get-typeof-names";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { applyStringMethod, isStringMethod } from "./utils/string-methods";
import { readContents } from "./utils/literal-receivers";
import { memoizeByIdentity } from "./utils/memoize-by-identity";

const SIZE_FIELD = "size";

interface Assumption {
  value: SymbolicValue;
  isTrue: boolean;
  places: BindingPlace[];
  hasUnknown: boolean;
}

export interface Constraints {
  possibleValues: PlaceMap<AbstractValue[]>;
  assumptions: Map<string, Assumption>;
  bounds: Bound[];
  boundGraph: BoundGraph | null;
  invariants: Bound[];
  finitePlaces: PlaceMap<true>;
  unionMemberValues: PlaceMap<AbstractValue[][]>;
  placeDomains: PlaceMap<Domain>;
  possibleMembers: Map<number, number[]>;
}

export const cloneConstraints = (constraints: Constraints): Constraints => ({
  possibleValues: constraints.possibleValues.clone(),
  assumptions: new Map(constraints.assumptions),
  bounds: constraints.bounds,
  boundGraph: constraints.boundGraph,
  invariants: constraints.invariants,
  finitePlaces: constraints.finitePlaces,
  unionMemberValues: constraints.unionMemberValues,
  placeDomains: constraints.placeDomains,
  possibleMembers: new Map(constraints.possibleMembers),
});

export const getLengthAtom = (bindingId: number, path: string[] = []): BindingPlace => ({
  bindingId,
  path: [...path, LENGTH_FIELD],
});

const formatPlaceEntries = <Value>(
  placeMap: PlaceMap<Value>,
  formatValue: (value: Value) => string,
): string =>
  [...placeMap]
    .map(([place, value]) => `${getPlaceKey(place)}=${formatValue(value)}`)
    .sort()
    .join(";");

const formatAbstractValues = memoizeByIdentity((values: AbstractValue[]): string =>
  values.map((value) => `${value.kind}:${formatAbstractValue(value)}`).join("|"),
);

const possibleValueIds = new Map<string, number>();

const getPossibleValueId = memoizeByIdentity(
  ([place, values]: [BindingPlace, AbstractValue[]]): number => {
    const entryKey = `${getPlaceKey(place)}=${formatAbstractValues(values)}`;
    const entryId = possibleValueIds.get(entryKey) ?? possibleValueIds.size;
    possibleValueIds.set(entryKey, entryId);
    return entryId;
  },
);

const formatPossibleValues = (possibleValues: PlaceMap<AbstractValue[]>): string =>
  Int32Array.from(possibleValues, getPossibleValueId).sort().join(",");

const formatBound = (bound: Bound): string =>
  `${getAtomKey(bound.left)}-${getAtomKey(bound.right)}${bound.isStrict ? "<" : "<="}${bound.maxDifference}${bound.mayBeNaN ? "?" : ""}`;

const formatBounds = memoizeByIdentity((bounds: Bound[]): string =>
  bounds.map(formatBound).sort().join(";"),
);

const formatAssumption = ([key, assumption]: [string, Assumption]): string =>
  `${key}=${assumption.isTrue}:${assumption.places.map(getPlaceKey).join(",")}`;

const formatUnionMemberValues = memoizeByIdentity(
  (unionMemberValues: PlaceMap<AbstractValue[][]>): string =>
    formatPlaceEntries(unionMemberValues, (members) => members.map(formatAbstractValues).join("/")),
);

const formatRelevantValues = (
  possibleValues: PlaceMap<AbstractValue[]>,
  bindingIds: ReadonlySet<number>,
): string =>
  Int32Array.from(possibleValues.entriesOf(bindingIds), getPossibleValueId).sort().join(",");

const formatAssumptions = (assumptions: Iterable<[string, Assumption]>): string =>
  [...assumptions].map(formatAssumption).sort().join(";");

const serializeConstraints = (
  constraints: Constraints,
  possibleValuesText: string,
  assumptionsText: string,
): string =>
  [
    possibleValuesText,
    assumptionsText,
    formatBounds(constraints.bounds),
    formatBounds(constraints.invariants),
    formatUnionMemberValues(constraints.unionMemberValues),
    [...constraints.possibleMembers]
      .map(([bindingId, members]) => `${bindingId}=${members.join(",")}`)
      .sort()
      .join(";"),
  ].join("\n");

export const getConstraintsKey = (constraints: Constraints): string =>
  serializeConstraints(
    constraints,
    formatPossibleValues(constraints.possibleValues),
    formatAssumptions(constraints.assumptions),
  );

const touchesBindings = (assumption: Assumption, bindingIds: ReadonlySet<number>): boolean =>
  assumption.places.some((place) => bindingIds.has(place.bindingId));

const getAssumedBindingIds = (
  constraints: Constraints,
  bindingIds: ReadonlySet<number>,
  addInputs: (bindingIds: Set<number>) => void,
): Set<number> => {
  const assumedIds = new Set(bindingIds);
  let isGrowing = true;
  while (isGrowing) {
    const size = assumedIds.size;
    for (const assumption of constraints.assumptions.values())
      if (touchesBindings(assumption, assumedIds))
        for (const place of assumption.places) assumedIds.add(place.bindingId);
    addInputs(assumedIds);
    isGrowing = assumedIds.size > size;
  }
  return assumedIds;
};

export const projectRelevantConstraints = (
  constraints: Constraints,
  bindingIds: ReadonlySet<number>,
  addInputs: (bindingIds: Set<number>) => void,
): Constraints => {
  const assumedIds = getAssumedBindingIds(constraints, bindingIds, addInputs);
  const possibleValues = new PlaceMap<AbstractValue[]>(
    constraints.possibleValues.entriesOf(assumedIds),
  );
  return {
    ...constraints,
    possibleValues,
    assumptions: new Map(constraints.assumptions),
    possibleMembers: new Map(constraints.possibleMembers),
  };
};

export const getRelevantConstraintsKey = (
  constraints: Constraints,
  bindingIds: ReadonlySet<number>,
  addInputs: (bindingIds: Set<number>) => void,
): string => {
  const assumedIds = getAssumedBindingIds(constraints, bindingIds, addInputs);
  return serializeConstraints(
    constraints,
    formatRelevantValues(constraints.possibleValues, assumedIds),
    formatAssumptions(
      [...constraints.assumptions].filter(
        ([, assumption]) =>
          assumption.places.length === 0 || touchesBindings(assumption, assumedIds),
      ),
    ),
  );
};

const collectPlaces = memoizeByIdentity((value: SymbolicValue): BindingPlace[] => {
  const places: BindingPlace[] = [];
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding") places.push(getValuePlace(part));
  });
  return places;
});

const getLiteralCases = (
  value: SymbolicValue,
  constraints: Constraints,
): PrimitiveValue[] | null => {
  const resolved = resolveLiteral(value, constraints);
  if (resolved.kind === "Primitive") return [resolved.value];
  const cases = getPossibleValues(value, constraints);
  return cases?.every((candidate) => candidate.kind === "Literal")
    ? cases.map((candidate) => candidate.value)
    : null;
};

const getCallValues = (derived: DerivedCall, constraints: Constraints): AbstractValue[] | null => {
  const operandCases = derived.operands.map((operand) => getLiteralCases(operand, constraints));
  if (!operandCases.every((cases): cases is PrimitiveValue[] => cases !== null)) return null;
  const results = applyPureFunctionToCases(derived.callee, operandCases);
  return results
    ? dedupeAbstractValues(results.map((value) => ({ kind: "Literal", value })))
    : null;
};

interface Projection {
  owner: BindingValue;
  project: (ownerValue: AbstractValue) => AbstractValue | null;
}

const projectString = (
  ownerValue: AbstractValue,
  read: (text: string) => PrimitiveValue,
): AbstractValue | null =>
  ownerValue.kind === "Literal" && typeof ownerValue.value === "string"
    ? { kind: "Literal", value: read(ownerValue.value) }
    : null;

const projectSize = (ownerValue: AbstractValue): AbstractValue | null =>
  ownerValue.kind === "Collection" ? { kind: "Literal", value: ownerValue.entries.length } : null;

const getProjection = (bindingValue: BindingValue): Projection | null => {
  const field = bindingValue.path.at(-1);
  const owner = { ...bindingValue, path: bindingValue.path.slice(0, -1) };
  if (field === LENGTH_FIELD)
    return { owner, project: (ownerValue) => projectString(ownerValue, (text) => text.length) };
  if (field === SIZE_FIELD) return { owner, project: projectSize };
  const { derived } = bindingValue.binding;
  if (bindingValue.path.length > 0 || !derived || derived.kind === "Call") return null;
  const { method, argumentValues } = derived;
  return {
    owner: derived.receiver,
    project: (ownerValue) => {
      if (isStringMethod(method))
        return projectString(ownerValue, (text) => applyStringMethod(method, text, argumentValues));
      const result = readContents(ownerValue, method, argumentValues);
      return result === null ? null : { kind: "Literal", value: result };
    },
  };
};

const getProjectedValues = (
  projection: Projection,
  constraints: Constraints,
): AbstractValue[] | null => {
  const ownerValues = getPossibleValues(projection.owner, constraints);
  if (!ownerValues) return null;
  const results: AbstractValue[] = [];
  for (const ownerValue of ownerValues) {
    const result = projection.project(ownerValue);
    if (!result) return null;
    results.push(result);
  }
  return dedupeAbstractValues(results);
};

export const getPossibleValues = (
  value: SymbolicValue,
  constraints: Constraints,
): AbstractValue[] | null => {
  if (value.kind !== "Binding") return null;
  const alias = getAlias(value);
  if (alias) return getValueCases(alias, constraints);
  const { derived } = value.binding;
  const isDerived = derived !== null && value.path.length === 0;
  const projection = getProjection(value);
  const projectedValues = projection && getProjectedValues(projection, constraints);
  const derivedValues =
    isDerived && derived.kind === "Call" ? getCallValues(derived, constraints) : projectedValues;
  const placeValues = constraints.possibleValues.get(getValuePlace(value));
  if (isDerived && derivedValues) return derivedValues;
  const lengthCases = projectedValues?.length ? projectedValues : null;
  if (!lengthCases || !placeValues) return lengthCases ?? placeValues ?? null;
  const placeLengths = new Set(
    placeValues.flatMap((placeValue) => (placeValue.kind === "Literal" ? [placeValue.value] : [])),
  );
  return placeLengths.size === placeValues.length
    ? lengthCases.filter((length) => length.kind === "Literal" && placeLengths.has(length.value))
    : lengthCases;
};

export const resolveLiteral = (value: SymbolicValue, constraints: Constraints): SymbolicValue => {
  if (isBooleanExpression(value)) {
    const outcome = evaluateCondition(value, constraints);
    return outcome === null ? value : { kind: "Primitive", value: outcome };
  }
  if (value.kind === "BinaryExpression") {
    const folded = foldBinary(
      value.operator,
      resolveLiteral(value.left, constraints),
      resolveLiteral(value.right, constraints),
    );
    return folded.kind === "Primitive" ? folded : value;
  }
  if (value.kind === "Conditional") {
    const test = evaluateCondition(getTestExpression(value), constraints);
    if (test === null) return value;
    const arm = resolveLiteral(test ? value.consequent : value.alternate, constraints);
    return arm.kind === "Primitive" ? arm : value;
  }
  const placeValues = getPossibleValues(value, constraints);
  const [onlyValue] = placeValues ?? [];
  return placeValues?.length === 1 && onlyValue?.kind === "Literal"
    ? { kind: "Primitive", value: onlyValue.value }
    : value;
};

interface Concatenation {
  operand: BindingValue;
  render: (candidate: AbstractValue) => string | null;
}

const getConcatenationParts = (value: SymbolicValue): SymbolicValue[] | null => {
  if (value.kind === "Primitive") return [value];
  if (value.kind === "Binding") return [value];
  if (value.kind !== "BinaryExpression" || value.operator !== "+") return null;
  const left = getConcatenationParts(value.left);
  const right = getConcatenationParts(value.right);
  return left && right ? [...left, ...right] : null;
};

const getConcatenation = (value: SymbolicValue): Concatenation | null => {
  const parts = getConcatenationParts(value);
  const operands = parts?.filter((part) => part.kind === "Binding") ?? [];
  const [operand] = operands;
  if (!parts || !operand || operands.length !== 1) return null;
  if (!parts.some((part) => part.kind === "Primitive" && typeof part.value === "string"))
    return null;
  return {
    operand,
    render: (candidate) =>
      candidate.kind === "Literal"
        ? parts
            .map((part) => String(part.kind === "Primitive" ? part.value : candidate.value))
            .join("")
        : null,
  };
};

const splitEquality = (value: BinaryExpressionValue): [SymbolicValue, SymbolicValue] =>
  value.left.kind === "Primitive" ? [value.right, value.left] : [value.left, value.right];

const distributedByKey = new Map<string, ConditionalValue | null>();

const distributeComparison = (value: SymbolicValue): ConditionalValue | null => {
  const valueKey = getValueKey(value);
  if (distributedByKey.has(valueKey)) return distributedByKey.get(valueKey) ?? null;
  const distributed = distributeUncachedComparison(value);
  distributedByKey.set(valueKey, distributed);
  return distributed;
};

const distributeUncachedComparison = (value: SymbolicValue): ConditionalValue | null => {
  if (value.kind !== "BinaryExpression" || !COMPARISON_OPERATORS.has(value.operator)) return null;
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

interface TypeofTest {
  operand: SymbolicValue;
  typeName: string;
}

const getTypeofTest = (value: BinaryExpressionValue): TypeofTest | null => {
  const [operandSide, literalSide] = splitEquality(value);
  if (operandSide.kind !== "UnaryExpression" || operandSide.operator !== "typeof") return null;
  if (literalSide.kind !== "Primitive" || typeof literalSide.value !== "string") return null;
  return { operand: operandSide.value, typeName: literalSide.value };
};

const canHaveTypeof = (value: AbstractValue, typeName: string, wantsMatch: boolean): boolean => {
  const typeofNames = getTypeofNames(value);
  if (!typeofNames) return true;
  return wantsMatch
    ? typeofNames.has(typeName)
    : typeofNames.size > 1 || !typeofNames.has(typeName);
};

const evaluateTypeof = (
  { operand, typeName }: TypeofTest,
  isNegated: boolean,
  constraints: Constraints,
): boolean | null => {
  const placeValues = getPossibleValues(operand, constraints);
  if (!placeValues) return null;
  if (placeValues.every((candidate) => !canHaveTypeof(candidate, typeName, false)))
    return !isNegated;
  if (placeValues.every((candidate) => !canHaveTypeof(candidate, typeName, true))) return isNegated;
  return null;
};

const evaluateConcatenationEquality = (
  concatenation: Concatenation,
  value: BinaryExpressionValue,
  constraints: Constraints,
): boolean | null => {
  const isNegated = NEGATED_EQUALITY_OPERATORS.has(value.operator);
  const [, literalSide] = splitEquality(value);
  const placeValues = getPossibleValues(concatenation.operand, constraints);
  const rendered = placeValues?.map(concatenation.render) ?? [];
  if (rendered.length === 0 || rendered.some((text) => text === null)) return null;
  if (literalSide.kind !== "Primitive" || typeof literalSide.value !== "string") return isNegated;
  const matchCount = rendered.filter((text) => text === literalSide.value).length;
  if (matchCount === rendered.length) return !isNegated;
  return matchCount === 0 ? isNegated : null;
};

const mayBeNaN = (candidate: AbstractValue): boolean => {
  if (candidate.kind === "Literal") return typeof candidate.value === "number";
  return (
    candidate.kind === "Type" && (candidate.primitive === "number" || candidate.primitive === null)
  );
};

const isSameStableValue = (
  left: SymbolicValue,
  right: SymbolicValue,
  constraints: Constraints,
): boolean => {
  if (left.kind !== "Binding" || left.binding.kind === "ref") return false;
  if (getValueKey(left) !== getValueKey(right)) return false;
  const placeValues = getPossibleValues(left, constraints);
  return placeValues !== null && !placeValues.some(mayBeNaN);
};

const evaluateEquality = (
  value: BinaryExpressionValue,
  constraints: Constraints,
): boolean | null => {
  const isNegated = NEGATED_EQUALITY_OPERATORS.has(value.operator);
  if (isSameStableValue(value.left, value.right, constraints)) return !isNegated;
  const typeofTest = getTypeofTest(value);
  if (typeofTest) return evaluateTypeof(typeofTest, isNegated, constraints);
  const [placeSide, literalSide] = splitEquality({
    ...value,
    left: resolveLiteral(value.left, constraints),
    right: resolveLiteral(value.right, constraints),
  });
  if (literalSide.kind !== "Primitive") return null;
  if (
    STRICT_EQUALITY_OPERATORS.has(value.operator) &&
    differsInTruthiness(placeSide, literalSide.value, constraints)
  )
    return isNegated;
  if (placeSide.kind === "Primitive")
    return getKnownTruthiness(foldBinary(value.operator, placeSide, literalSide));
  if (placeSide.kind === "Conditional") {
    const test = evaluateCondition(getTestExpression(placeSide), constraints);
    if (test === null) return null;
    const arm = test ? placeSide.consequent : placeSide.alternate;
    return evaluateEquality({ ...value, left: arm, right: literalSide }, constraints);
  }
  const concatenation = getConcatenation(placeSide);
  if (concatenation) return evaluateConcatenationEquality(concatenation, value, constraints);
  const placeValues = getPossibleValues(placeSide, constraints);
  if (!placeValues) return null;
  const matchCount = placeValues.filter((candidate) =>
    isEqualToLiteral(candidate, literalSide.value, value.operator),
  ).length;
  const canAnyEqual = placeValues.some((candidate) =>
    canTypeEqualLiteral(candidate, literalSide.value, value.operator),
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

const compareNumbers = (left: number, right: number, operator: BinaryOperator): boolean | null => {
  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    default:
      return null;
  }
};

const splitComparison = (
  value: BinaryExpressionValue,
): [BindingValue, number, BinaryOperator] | null => {
  const { left, right, operator } = value;
  const mirrored = MIRRORED_OPERATORS.get(operator) ?? operator;
  if (left.kind === "Binding" && right.kind === "Primitive" && typeof right.value === "number")
    return [left, right.value, operator];
  if (right.kind === "Binding" && left.kind === "Primitive" && typeof left.value === "number")
    return [right, left.value, mirrored];
  return null;
};

const compareCase = (
  candidate: AbstractValue,
  literal: number,
  operator: BinaryOperator,
): boolean | null =>
  candidate.kind === "Literal" && typeof candidate.value === "number"
    ? compareNumbers(candidate.value, literal, operator)
    : null;

const evaluateComparison = (
  value: BinaryExpressionValue,
  constraints: Constraints,
): boolean | null => {
  const left = resolveLiteral(value.left, constraints);
  const right = resolveLiteral(value.right, constraints);
  if (left.kind === "Primitive" && right.kind === "Primitive")
    return getKnownTruthiness(foldBinary(value.operator, left, right));
  const split = splitComparison(value);
  const placeValues = split && getPossibleValues(split[0], constraints);
  if (!split || !placeValues || placeValues.length === 0) return null;
  const outcomes = placeValues.map((candidate) => compareCase(candidate, split[1], split[2]));
  if (outcomes.every((outcome) => outcome === true)) return true;
  if (outcomes.every((outcome) => outcome === false)) return false;
  return null;
};

const evaluateTruthiness = (placeValues: AbstractValue[]): boolean | null => {
  if (placeValues.length === 0) return null;
  const truthiness = placeValues.map(getTruthiness);
  if (truthiness.every((candidate) => candidate === "truthy")) return true;
  if (truthiness.every((candidate) => candidate === "falsy")) return false;
  return null;
};

const getEqualityCounterpart = memoizeByIdentity(
  (value: SymbolicValue): BinaryExpressionValue | null => {
    if (value.kind !== "BinaryExpression" || !EQUALITY_OPERATORS.has(value.operator)) return null;
    const operator = getNegatedOperator(value.operator);
    return operator ? { ...value, operator } : null;
  },
);

const getAlias = (value: SymbolicValue): SymbolicValue | null =>
  value.kind === "Binding" && value.path.length === 0 ? value.binding.alias : null;

const expandAliasOperands = memoizeByIdentity((value: SymbolicValue): SymbolicValue | null => {
  const alias = getAlias(value);
  if (alias) return alias;
  if (value.kind === "UnaryExpression") {
    const operand = getAlias(value.value);
    return operand && { ...value, value: operand };
  }
  if (value.kind !== "BinaryExpression") return null;
  const left = getAlias(value.left);
  const right = getAlias(value.right);
  return left || right ? { ...value, left: left ?? value.left, right: right ?? value.right } : null;
});

const evaluateAlias = (value: SymbolicValue, constraints: Constraints): boolean | null => {
  const distributed = value.kind === "BinaryExpression" ? distributeComparison(value) : null;
  const condition = distributed ?? value;
  if (condition.kind !== "Conditional") return evaluateCondition(condition, constraints);
  const test = getTestExpression(condition);
  const whenTrue = assumeCondition(test, true, constraints);
  const whenFalse = assumeCondition(test, false, constraints);
  const consequent = whenTrue && evaluateAlias(condition.consequent, whenTrue);
  const alternate = whenFalse && evaluateAlias(condition.alternate, whenFalse);
  if (!whenTrue) return alternate ?? null;
  if (!whenFalse) return consequent ?? null;
  return consequent !== null && consequent === alternate ? consequent : null;
};

const MAX_CASE_COMBINATIONS = 16;

const getPureCall = (value: SymbolicValue): DerivedCall | null => {
  const derived =
    value.kind === "Binding" && value.path.length === 0 ? value.binding.derived : null;
  return derived && derived.kind === "Call" && isPureFunction(derived.callee) ? derived : null;
};

const isPlainBinding = (value: SymbolicValue): boolean =>
  value.kind === "Binding" && getPureCall(value) === null;

const isNestedTest = (value: SymbolicValue): boolean =>
  (value.kind === "BinaryExpression" &&
    !isPlainBinding(value.left) &&
    !isPlainBinding(value.right)) ||
  (value.kind === "UnaryExpression" && value.operator !== "!");

const collectCaseBindings = (value: SymbolicValue, bindingsByKey: Map<string, BindingValue>) => {
  const pureCall = getPureCall(value);
  if (pureCall) {
    for (const operand of pureCall.operands) collectCaseBindings(operand, bindingsByKey);
    return;
  }
  if (value.kind === "BinaryExpression") {
    collectCaseBindings(value.left, bindingsByKey);
    collectCaseBindings(value.right, bindingsByKey);
    return;
  }
  if (value.kind === "UnaryExpression") {
    collectCaseBindings(value.value, bindingsByKey);
    return;
  }
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding") bindingsByKey.set(getPlaceKey(getValuePlace(part)), part);
  });
};

const getCaseBindings = memoizeByIdentity((value: SymbolicValue): BindingValue[] => {
  const bindingsByKey = new Map<string, BindingValue>();
  collectCaseBindings(value, bindingsByKey);
  return [...bindingsByKey.values()];
});

const foldCase = (
  value: SymbolicValue,
  valuesByKey: ReadonlyMap<string, PrimitiveValue>,
): SymbolicValue => {
  const pureCall = getPureCall(value);
  if (pureCall) {
    const operands = pureCall.operands.map((operand) => foldCase(operand, valuesByKey));
    const primitives = operands.flatMap((operand) =>
      operand.kind === "Primitive" ? [operand.value] : [],
    );
    const result =
      primitives.length === operands.length ? applyPureFunction(pureCall.callee, primitives) : null;
    return result === null ? value : { kind: "Primitive", value: result };
  }
  if (value.kind === "Binding") {
    const key = getPlaceKey(getValuePlace(value));
    return valuesByKey.has(key) ? { kind: "Primitive", value: valuesByKey.get(key) } : value;
  }
  if (value.kind === "BinaryExpression")
    return foldBinary(
      value.operator,
      foldCase(value.left, valuesByKey),
      foldCase(value.right, valuesByKey),
    );
  if (value.kind === "UnaryExpression")
    return foldUnary(value.operator, foldCase(value.value, valuesByKey));
  return value;
};

const getCaseOutcome = (
  value: SymbolicValue,
  valuesByKey: ReadonlyMap<string, PrimitiveValue>,
): boolean | null => {
  const folded = foldCase(value, valuesByKey);
  return folded.kind === "Primitive" ? Boolean(folded.value) : null;
};

const evaluateByCases = (value: SymbolicValue, constraints: Constraints): boolean | null => {
  if (!isNestedTest(value)) return null;
  const bindings = getCaseBindings(value);
  if (bindings.length === 0 || bindings.length > 2) return null;
  const cases = bindings.map((binding) => getLiteralCases(binding, constraints));
  if (cases.some((literals) => literals === null || literals.length === 0)) return null;
  const literalCases = cases.filter((literals): literals is PrimitiveValue[] => literals !== null);
  const combinationCount = literalCases.reduce((count, literals) => count * literals.length, 1);
  if (combinationCount > MAX_CASE_COMBINATIONS) return null;
  const combinations = literalCases.reduce<PrimitiveValue[][]>(
    (prefixes, literals) =>
      prefixes.flatMap((prefix) => literals.map((literal) => [...prefix, literal])),
    [[]],
  );
  const keys = bindings.map((binding) => getPlaceKey(getValuePlace(binding)));
  const outcomes = combinations.map((combination) =>
    getCaseOutcome(value, new Map(keys.map((key, index) => [key, combination[index]]))),
  );
  const [first] = outcomes;
  return first !== undefined && first !== null && outcomes.every((outcome) => outcome === first)
    ? first
    : null;
};

const narrowByCase = (
  value: SymbolicValue,
  binding: BindingValue,
  candidate: AbstractValue,
  isTrue: boolean,
): AbstractValue[] => {
  if (candidate.kind !== "Literal") return [candidate];
  const outcome = getCaseOutcome(
    value,
    new Map([[getPlaceKey(getValuePlace(binding)), candidate.value]]),
  );
  return outcome === null || outcome === isTrue ? [candidate] : [];
};

interface ConditionMemo {
  constraints: Constraints;
  outcomes: Map<string, boolean | null>;
}

let activeConditionMemo: ConditionMemo | null = null;

export const evaluateCondition = (
  value: SymbolicValue,
  constraints: Constraints,
): boolean | null => {
  const outerMemo = activeConditionMemo;
  const memo =
    outerMemo?.constraints === constraints ? outerMemo : { constraints, outcomes: new Map() };
  const valueKey = getValueKey(value);
  if (memo.outcomes.has(valueKey)) return memo.outcomes.get(valueKey) ?? null;
  activeConditionMemo = memo;
  try {
    const outcome = evaluateUncachedCondition(value, constraints);
    memo.outcomes.set(valueKey, outcome);
    return outcome;
  } finally {
    activeConditionMemo = outerMemo;
  }
};

const isKnownMember = (
  key: SymbolicValue,
  object: SymbolicValue,
  constraints: Constraints,
): boolean => {
  if (key.kind !== "Primitive" || object.kind !== "Binding") return false;
  const fieldValues = getPossibleValues(
    { ...object, path: [...object.path, String(key.value)] },
    constraints,
  );
  return (
    fieldValues !== null &&
    fieldValues.length > 0 &&
    fieldValues.every((field) => field.kind === "Literal" && field.value !== undefined)
  );
};

const evaluateUncachedCondition = (
  value: SymbolicValue,
  constraints: Constraints,
): boolean | null => {
  const assumption = constraints.assumptions.get(getValueKey(value));
  if (assumption) return assumption.isTrue;
  const expanded = expandAliasOperands(value);
  if (expanded) return evaluateAlias(expanded, constraints);
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
      if (value.operator !== "!") return evaluateByCases(value, constraints);
      const operand = evaluateCondition(value.value, constraints);
      return operand === null ? null : !operand;
    }
    case "BinaryExpression": {
      if (value.operator === "in" && isKnownMember(value.left, value.right, constraints))
        return true;
      const distributed = distributeComparison(value);
      if (distributed) return evaluateCondition(distributed, constraints);
      const bounded = evaluateBounds(value, constraints);
      if (bounded !== null) return bounded;
      const compared = ORDER_OPERATORS.has(value.operator)
        ? evaluateComparison(value, constraints)
        : EQUALITY_OPERATORS.has(value.operator)
          ? evaluateEquality(value, constraints)
          : null;
      return compared ?? evaluateByCases(value, constraints);
    }
    case "Conditional": {
      const test = evaluateCondition(getTestExpression(value), constraints);
      if (test === null) return null;
      const arm = test ? value.consequent : value.alternate;
      if (value.testKind === "truthy" && arm === value.test) return test;
      return evaluateCondition(arm, constraints);
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

const narrowOwner = (
  bindingValue: BindingValue,
  constraints: Constraints,
  narrowedValues: AbstractValue[],
): Constraints | null => {
  const projection = getProjection(bindingValue);
  if (!projection || !narrowedValues.every((value) => value.kind === "Literal")) return constraints;
  const ownerValues = getPossibleValues(projection.owner, constraints);
  if (!ownerValues?.every((value) => projection.project(value) !== null)) return constraints;
  const allowedKeys = getAbstractValueKeys(narrowedValues);
  return narrowPlace(projection.owner, constraints, (candidate) => {
    const projected = projection.project(candidate);
    return projected && !allowedKeys.has(formatAbstractValue(projected)) ? [] : [candidate];
  });
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
  const withMembers = narrowUnionMembers(narrowed, place, narrowedValues);
  const withOwner = withMembers && narrowOwner(bindingValue, withMembers, narrowedValues);
  return withOwner && withLiteralLengths(withOwner, place, narrowedValues);
};

const withLiteralLengths = (
  constraints: Constraints,
  place: BindingPlace,
  values: AbstractValue[],
): Constraints | null => {
  const length: BindingPlace = { bindingId: place.bindingId, path: [...place.path, LENGTH_FIELD] };
  const isBounded = constraints.bounds.some(
    (bound) => isAtomAt(bound.left, length) || isAtomAt(bound.right, length),
  );
  const lengths = values.flatMap((value) =>
    value.kind === "Literal" && typeof value.value === "string" ? [value.value.length] : [],
  );
  if (!isBounded || lengths.length !== values.length) return constraints;
  addBounds(constraints, [
    { left: length, right: null, maxDifference: Math.max(...lengths), isStrict: false },
    { left: null, right: length, maxDifference: -Math.min(...lengths), isStrict: false },
  ]);
  return isConsistent(getBoundGraph(constraints)) ? constraints : null;
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
  value,
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
  left.intersect(right, (place, leftValues, rightValues) => {
    if (hasNullishAncestor(place, left)) return rightValues;
    if (hasNullishAncestor(place, right)) return leftValues;
    return dedupeAbstractValues([...leftValues, ...rightValues]);
  });

export const joinConstraints = (left: Constraints, right: Constraints): Constraints => {
  const rightBoundKeys = new Set(right.bounds.map(formatBound));
  const bounds = left.bounds.filter((bound) => rightBoundKeys.has(formatBound(bound)));
  const isSameBounds =
    bounds.length === left.bounds.length &&
    new Set(left.bounds.map(formatBound)).size === rightBoundKeys.size;
  return {
    possibleValues: joinPlaceValues(left.possibleValues, right.possibleValues),
    assumptions: new Map(
      [...left.assumptions].filter(
        ([key, assumption]) => right.assumptions.get(key)?.isTrue === assumption.isTrue,
      ),
    ),
    bounds,
    boundGraph: isSameBounds ? left.boundGraph : null,
    invariants: left.invariants,
    finitePlaces: left.finitePlaces,
    unionMemberValues: left.unionMemberValues,
    placeDomains: left.placeDomains,
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
  const expanded = expandAliasOperands(value);
  if (expanded) return assumeMemoized(expanded, isTrue, constraints, memo);
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
  if (value.kind === "Binding") {
    const assumed = getPossibleValues(value, constraints)
      ? assumeByNarrowing(value, isTrue, value, constraints, (candidate) =>
          narrowTruthiness(candidate, isTrue),
        )
      : assumeOpaqueCondition(value, isTrue, constraints);
    return assumed && withStringLengthBounds(value, isTrue, assumed);
  }
  const [caseBinding, ...otherBindings] = isNestedTest(value) ? getCaseBindings(value) : [];
  if (
    caseBinding &&
    otherBindings.length === 0 &&
    (getLiteralCases(caseBinding, constraints)?.length ?? 0) > 0
  )
    return assumeByNarrowing(value, isTrue, caseBinding, constraints, (candidate) =>
      narrowByCase(value, caseBinding, candidate, isTrue),
    );
  if (value.kind === "BinaryExpression" && EQUALITY_OPERATORS.has(value.operator))
    return assumeEquality(value, isTrue, constraints);
  if (value.kind === "BinaryExpression" && ORDER_OPERATORS.has(value.operator))
    return assumeComparison(value, isTrue, constraints);
  return assumeOpaqueCondition(value, isTrue, constraints);
};

const touchesPlaces = (assumption: Assumption, places: BindingPlace[]): boolean =>
  assumption.places.some((place) =>
    places.some((other) => isPlacePrefix(place, other) || isPlacePrefix(other, place)),
  );

const keepsEarlierAssumptions = (value: SymbolicValue, constraints: Constraints): boolean => {
  const places = collectPlaces(value);
  let others: Constraints | null = null;
  for (const [assumptionKey, assumption] of constraints.assumptions) {
    if (!touchesPlaces(assumption, places)) continue;
    others ??= { ...constraints, assumptions: new Map(constraints.assumptions) };
    others.assumptions.delete(assumptionKey);
    const outcome = evaluateCondition(assumption.value, others);
    others.assumptions.set(assumptionKey, assumption);
    if (outcome !== null && outcome !== assumption.isTrue) return false;
  }
  return true;
};

const isStringCase = (value: AbstractValue): boolean =>
  value.kind === "Literal"
    ? typeof value.value === "string"
    : value.kind === "Type" && value.primitive === "string";

const isStringValue = (value: BindingValue, constraints: Constraints): boolean => {
  const placeValues = getPossibleValues(value, constraints);
  if (placeValues) return placeValues.every(isStringCase);
  const { domain } = value.binding;
  return value.path.length === 0 && domain.kind === "Opaque" && domain.typeText === "string";
};

const withStringLengthBounds = (
  value: BindingValue,
  isTrue: boolean,
  assumed: Constraints,
): Constraints | null => {
  if (!isStringValue(value, assumed)) return assumed;
  const length: BindingPlace = { bindingId: value.binding.id, path: [...value.path, LENGTH_FIELD] };
  addBounds(assumed, [
    isTrue
      ? { left: null, right: length, maxDifference: -1, isStrict: false }
      : { left: length, right: null, maxDifference: 0, isStrict: false },
  ]);
  return isConsistent(getBoundGraph(assumed)) ? assumed : null;
};

const assumeComparison = (
  value: BinaryExpressionValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  const split = splitComparison(value);
  if (!split || !getPossibleValues(split[0], constraints))
    return assumeOpaqueCondition(value, isTrue, constraints);
  return assumeByNarrowing(value, isTrue, split[0], constraints, (candidate) =>
    compareCase(candidate, split[1], split[2]) === !isTrue ? [] : [candidate],
  );
};

export const assumeBranchOutcome = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => assumeMemoized(value, isTrue, constraints, new Map());

export const assumeCondition = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  const assumed = assumeMemoized(value, isTrue, constraints, new Map());
  return assumed && keepsEarlierAssumptions(value, assumed) ? assumed : null;
};

const assumeEquality = (
  value: BinaryExpressionValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  const typeofTest = getTypeofTest(value);
  if (typeofTest) return assumeTypeof(value, typeofTest, isTrue, constraints);
  const [placeSide, literalSide] = splitEquality(value);
  const wantsMatch = isTrue !== NEGATED_EQUALITY_OPERATORS.has(value.operator);
  const literal = literalSide.kind === "Primitive" ? literalSide.value : undefined;
  const concatenation = literalSide.kind === "Primitive" ? getConcatenation(placeSide) : null;
  if (concatenation && getPossibleValues(concatenation.operand, constraints))
    return assumeByNarrowing(value, isTrue, concatenation.operand, constraints, (candidate) => {
      const text = concatenation.render(candidate);
      return text === null || (text === literal) === wantsMatch ? [candidate] : [];
    });
  if (literalSide.kind !== "Primitive" || placeSide.kind !== "Binding")
    return assumeOpaqueCondition(value, isTrue, constraints);
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
): Constraints | null => {
  const assumed = cloneConstraints(constraints);
  const place = getValuePlace(bindingValue);
  const values = getEqualLiterals(literal);
  assumed.possibleValues.set(place, values);
  return withLiteralLengths(assumed, place, values);
};

const getEqualLiterals = (literal: PrimitiveValue): AbstractValue[] =>
  (literal === 0 ? [0, -0] : [literal]).map((value) => ({ kind: "Literal", value }));

const assumeTypeof = (
  value: BinaryExpressionValue,
  { operand, typeName }: TypeofTest,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  if (operand.kind !== "Binding" || !getPossibleValues(operand, constraints))
    return assumeOpaqueCondition(value, isTrue, constraints);
  const wantsMatch = isTrue !== NEGATED_EQUALITY_OPERATORS.has(value.operator);
  return assumeByNarrowing(value, isTrue, operand, constraints, (candidate) =>
    canHaveTypeof(candidate, typeName, wantsMatch) ? [candidate] : [],
  );
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
  if (!canTypeEqualLiteral(value, literal, operator)) return wantsMatch ? [] : [value];
  if (wantsMatch && value.kind === "Type" && value.primitive === typeof literal)
    return getEqualLiterals(literal);
  return [value];
};

const assumeOpaqueCondition = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints,
): Constraints | null => {
  const assumed = cloneConstraints(constraints);
  assumed.assumptions.set(getValueKey(value), createAssumption(value, isTrue));
  const assumedBounds = getBounds(value, isTrue, constraints);
  if (assumedBounds) {
    addBounds(assumed, assumedBounds);
    if (!isConsistent(getBoundGraph(assumed))) return null;
  }
  return assumed;
};

export const isAtomAt = (atom: BindingPlace | null, place: BindingPlace): boolean =>
  atom !== null && isSamePlace(atom, place);

export const forgetBinding = (
  constraints: Constraints,
  bindingId: number,
  shouldKeepLength: boolean,
  unchangedPaths: string[][] = [],
): void => {
  const lengthAtom = getLengthAtom(bindingId);
  constraints.possibleMembers.delete(bindingId);
  for (const [assumptionKey, assumption] of constraints.assumptions) {
    if (!assumption.places.some((place) => place.bindingId === bindingId)) continue;
    const isUnchanged = assumption.places.every(
      (place) =>
        place.bindingId !== bindingId ||
        unchangedPaths.some(
          (path) =>
            path.length > 0 && path.every((segment, index) => place.path[index] === segment),
        ),
    );
    if (isUnchanged) continue;
    if (
      shouldKeepLength &&
      assumption.places.every(
        (place) => place.bindingId !== bindingId || isSamePlace(place, lengthAtom),
      )
    )
      continue;
    constraints.assumptions.delete(assumptionKey);
  }
  const bounds = constraints.bounds.filter(
    (bound) =>
      (bound.left?.bindingId !== bindingId && bound.right?.bindingId !== bindingId) ||
      (shouldKeepLength && (isAtomAt(bound.left, lengthAtom) || isAtomAt(bound.right, lengthAtom))),
  );
  if (bounds.length === constraints.bounds.length) return;
  constraints.bounds = bounds;
  constraints.boundGraph = null;
};

export const assumeGuards = (
  guards: SymbolicValue[],
  constraints: Constraints,
): Constraints | null =>
  guards.reduce<Constraints | null>(
    (current, guard) => current && assumeCondition(guard, true, current),
    constraints,
  );

const isCoalescing = (value: ConditionalValue): boolean =>
  value.testKind === "nullish" && getValueKey(value.test) === getValueKey(value.consequent);

const getBranchCases = (
  value: ConditionalValue,
  constraints: Constraints,
): AbstractValue[] | null => {
  const test = getTestExpression(value);
  const decided = evaluateCondition(test, constraints);
  if (decided !== null)
    return getValueCases(decided ? value.consequent : value.alternate, constraints);
  const whenTrue = assumeCondition(test, true, constraints);
  const whenFalse = assumeCondition(test, false, constraints);
  const consequent = whenTrue ? getValueCases(value.consequent, whenTrue) : [];
  const alternate = whenFalse ? getValueCases(value.alternate, whenFalse) : [];
  if (!consequent || !alternate) return null;
  const kept = isCoalescing(value) ? consequent.filter((item) => !isNullishCase(item)) : consequent;
  return dedupeAbstractValues([...kept, ...alternate]);
};

export const getValueCases = (
  value: SymbolicValue,
  constraints: Constraints,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind === "Conditional") return getBranchCases(value, constraints);
  return hasUnknownPart(value) ? null : getPossibleValues(value, constraints);
};

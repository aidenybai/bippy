import { createHash } from "node:crypto";
import type {
  AbstractValue,
  BinaryExpressionValue,
  BinaryOperator,
  BindingValue,
  BindingPlace,
  ConditionalValue,
  DerivedCall,
  DerivedString,
  PrimitiveValue,
  SymbolicValue,
} from "./types";
import { canTypeEqualLiteral } from "./utils/can-type-equal-literal";
import { isEqualToLiteral } from "./utils/is-equal-to-literal";
import { formatAbstractValue } from "./format";
import { getValueKey } from "./utils/get-value-key";
import { isPlacePrefix } from "./utils/is-place-prefix";
import { PlaceMap } from "./utils/place-map";
import { getPlaceKey } from "./utils/get-place-key";
import { getValuePlace } from "./utils/get-value-place";
import { isSamePlace } from "./utils/is-same-place";
import { foldBinary } from "./symbolic-values";
import { applyPureFunctionToCases } from "./utils/pure-functions";
import { getKnownTruthiness } from "./utils/get-known-truthiness";
import { isBooleanExpression } from "./utils/is-boolean-expression";
import { isNullish } from "./utils/is-nullish";
import { isNullishCase } from "./utils/is-nullish-case";
import { getNegatedOperator } from "./utils/get-negated-operator";
import { getTestExpression } from "./utils/get-test-expression";
import { getTruthiness } from "./utils/get-truthiness";
import { getTypeofNames } from "./utils/get-typeof-names";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { applyStringMethod } from "./utils/string-methods";
import { memoizeByIdentity } from "./utils/memoize-by-identity";

const CONSTANT_KEY = "#";
const LENGTH_FIELD = "length";
export const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
const NEGATED_EQUALITY_OPERATORS = new Set(["!==", "!="]);
const STRICT_EQUALITY_OPERATORS = new Set(["===", "!=="]);
const COMPARISON_OPERATORS = new Set([...EQUALITY_OPERATORS, "<", "<=", ">", ">="]);
const BOUND_OPERATORS = new Set(["<", "<=", ">", ">=", "===", "=="]);
const ORDER_OPERATORS = new Set(["<", "<=", ">", ">="]);
const MIRRORED_OPERATORS = new Map<BinaryOperator, BinaryOperator>([
  ["<", ">"],
  ["<=", ">="],
  [">", "<"],
  [">=", "<="],
]);

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
  value: SymbolicValue;
  isTrue: boolean;
  places: BindingPlace[];
  hasUnknown: boolean;
}

export interface BoundGraph {
  indicesByAtomKey: Map<string, number>;
  distances: Distance[][];
}

export interface Constraints {
  possibleValues: PlaceMap<AbstractValue[]>;
  assumptions: Map<string, Assumption>;
  bounds: Bound[];
  boundGraph: BoundGraph | null;
  invariants: Bound[];
  finitePlaces: PlaceMap<true>;
  unionMemberValues: PlaceMap<AbstractValue[][]>;
  possibleMembers: Map<number, number[]>;
}

export const cloneConstraints = (constraints: Constraints): Constraints => ({
  possibleValues: constraints.possibleValues.clone(),
  assumptions: new Map(constraints.assumptions),
  bounds: [...constraints.bounds],
  boundGraph: constraints.boundGraph,
  invariants: constraints.invariants,
  finitePlaces: constraints.finitePlaces,
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

const formatAbstractValues = memoizeByIdentity((values: AbstractValue[]): string =>
  values.map((value) => `${value.kind}:${formatAbstractValue(value)}`).join("|"),
);

const formatBound = (bound: Bound): string =>
  `${getAtomKey(bound.left)}-${getAtomKey(bound.right)}${bound.isStrict ? "<" : "<="}${bound.maxDifference}`;

const formatBounds = (bounds: Bound[]): string => bounds.map(formatBound).sort().join(";");

const formatInvariants = memoizeByIdentity(formatBounds);

const formatAssumption = ([key, assumption]: [string, Assumption]): string =>
  `${key}=${assumption.isTrue}:${assumption.places.map(getPlaceKey).join(",")}`;

const formatUnionMemberValues = memoizeByIdentity(
  (unionMemberValues: PlaceMap<AbstractValue[][]>): string =>
    formatPlaceEntries(unionMemberValues, (members) => members.map(formatAbstractValues).join("/")),
);

const serializeConstraints = (constraints: Constraints): string =>
  [
    formatPlaceEntries(constraints.possibleValues, formatAbstractValues),
    [...constraints.assumptions].map(formatAssumption).sort().join(";"),
    formatBounds(constraints.bounds),
    formatInvariants(constraints.invariants),
    formatUnionMemberValues(constraints.unionMemberValues),
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

const appearsIn = (atom: BindingPlace, bounds: Bound[]): boolean =>
  bounds.some((bound) =>
    [bound.left, bound.right].some((side) => side !== null && isSamePlace(side, atom)),
  );

const everyCase = (
  atom: BindingPlace,
  constraints: Constraints,
  predicate: (value: AbstractValue) => boolean,
): boolean => constraints.possibleValues.get(atom)?.every(predicate) ?? false;

const isNumberAtom = (atom: BindingPlace, constraints: Constraints): boolean =>
  atom.path.at(-1) === LENGTH_FIELD ||
  everyCase(
    atom,
    constraints,
    (value) =>
      value.kind === "Literal" && typeof value.value === "number" && !Number.isNaN(value.value),
  ) ||
  appearsIn(atom, [...constraints.invariants, ...constraints.bounds]);

const isNumericAtom = (atom: BindingPlace, constraints: Constraints): boolean =>
  atom.path.at(-1) === LENGTH_FIELD ||
  everyCase(atom, constraints, (value) =>
    value.kind === "Literal" ? typeof value.value === "number" : value.primitive === "number",
  ) ||
  appearsIn(atom, constraints.invariants);

const isFiniteAtom = (atom: BindingPlace, constraints: Constraints): boolean =>
  atom.path.at(-1) === LENGTH_FIELD ||
  everyCase(
    atom,
    constraints,
    (value) =>
      value.kind === "Literal" && typeof value.value === "number" && Number.isFinite(value.value),
  ) ||
  constraints.finitePlaces.has(atom);

const isNumberValue = (value: SymbolicValue, constraints: Constraints): boolean => {
  if (value.kind === "Conditional")
    return (
      isNumberValue(value.consequent, constraints) && isNumberValue(value.alternate, constraints)
    );
  const term = getLinearTerm(value);
  return term !== null && (term.atom === null || isNumberAtom(term.atom, constraints));
};

export const isComplementNegation = (
  value: BinaryExpressionValue,
  constraints: Constraints,
): boolean =>
  !ORDER_OPERATORS.has(value.operator) ||
  [value.left, value.right].every((side) => isNumberValue(side, constraints));

export const getBounds = (
  value: SymbolicValue,
  isTrue: boolean,
  constraints: Constraints | null = null,
): Bound[] | null => {
  if (value.kind !== "BinaryExpression") return null;
  if (!isTrue && constraints && !isComplementNegation(value, constraints)) return null;
  const operator = isTrue ? value.operator : getNegatedOperator(value.operator);
  if (!operator || !BOUND_OPERATORS.has(operator)) return null;
  const leftTerm = getLinearTerm(value.left);
  const rightTerm = getLinearTerm(value.right);
  if (!leftTerm || !rightTerm || (leftTerm.atom === null && rightTerm.atom === null)) return null;
  const offsetDifference = rightTerm.offset - leftTerm.offset;
  const atoms = [leftTerm.atom, rightTerm.atom].filter(
    (atom): atom is BindingPlace => atom !== null,
  );
  const isBetweenAtoms = constraints !== null && atoms.length === 2;
  if (isBetweenAtoms && !atoms.every((atom) => isNumericAtom(atom, constraints))) return null;
  if (
    isBetweenAtoms &&
    offsetDifference !== 0 &&
    !atoms.every((atom) => isFiniteAtom(atom, constraints))
  )
    return null;
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

const UNREACHABLE: Distance = { weight: Infinity, isStrict: false };

const SELF: Distance = { weight: 0, isStrict: false };

const EMPTY_GRAPH: BoundGraph = {
  indicesByAtomKey: new Map([[CONSTANT_KEY, 0]]),
  distances: [[SELF]],
};

const getLengthBound = (atom: BindingPlace | null): Bound | null =>
  atom?.path.at(-1) === LENGTH_FIELD
    ? { left: null, right: atom, maxDifference: 0, isStrict: false }
    : null;

const withAtom = (graph: BoundGraph, atom: BindingPlace | null): BoundGraph => {
  const atomKey = getAtomKey(atom);
  if (graph.indicesByAtomKey.has(atomKey)) return graph;
  const size = graph.distances.length;
  const grown: BoundGraph = {
    indicesByAtomKey: new Map(graph.indicesByAtomKey).set(atomKey, size),
    distances: [
      ...graph.distances.map((row) => [...row, UNREACHABLE]),
      [...Array.from({ length: size }, () => UNREACHABLE), SELF],
    ],
  };
  const lengthBound = getLengthBound(atom);
  return lengthBound ? withBound(grown, lengthBound) : grown;
};

const withBound = (graph: BoundGraph, bound: Bound): BoundGraph => {
  const { indicesByAtomKey, distances } = withAtom(withAtom(graph, bound.left), bound.right);
  const from = indicesByAtomKey.get(getAtomKey(bound.right)) ?? 0;
  const to = indicesByAtomKey.get(getAtomKey(bound.left)) ?? 0;
  const edge: Distance = { weight: bound.maxDifference, isStrict: bound.isStrict };
  if (!isShorter(edge, distances[from][to])) return { indicesByAtomKey, distances };
  return {
    indicesByAtomKey,
    distances: distances.map((row, rowIndex) =>
      row.map((current, columnIndex) => {
        const toEdge = distances[rowIndex][from];
        const fromEdge = distances[to][columnIndex];
        const throughEdge: Distance = {
          weight: toEdge.weight + edge.weight + fromEdge.weight,
          isStrict: toEdge.isStrict || edge.isStrict || fromEdge.isStrict,
        };
        return isShorter(throughEdge, current) ? throughEdge : current;
      }),
    ),
  };
};

const isConsistent = (graph: BoundGraph): boolean =>
  graph.distances.every((row, atomIndex) => {
    const cycle = row[atomIndex];
    return !(cycle.weight < 0 || (cycle.weight === 0 && cycle.isStrict));
  });

const getBoundGraph = (constraints: Constraints): BoundGraph =>
  (constraints.boundGraph ??= [...constraints.invariants, ...constraints.bounds].reduce(
    withBound,
    EMPTY_GRAPH,
  ));

const isBoundedEquality = (
  value: BinaryExpressionValue,
  graph: BoundGraph,
  constraints: Constraints,
): boolean => {
  const below = getBounds({ ...value, operator: "<" }, true, constraints);
  const above = getBounds({ ...value, operator: ">" }, true, constraints);
  return (
    below !== null &&
    above !== null &&
    !isConsistent(below.reduce(withBound, graph)) &&
    !isConsistent(above.reduce(withBound, graph))
  );
};

const evaluateBounds = (value: SymbolicValue, constraints: Constraints): boolean | null => {
  if (constraints.invariants.length === 0 && constraints.bounds.length === 0) return null;
  const graph = getBoundGraph(constraints);
  const whenTrue = getBounds(value, true, constraints);
  const whenFalse = getBounds(value, false, constraints);
  if (whenTrue && !isConsistent(whenTrue.reduce(withBound, graph))) return false;
  if (whenFalse && !isConsistent(whenFalse.reduce(withBound, graph))) return true;
  if (
    value.kind === "BinaryExpression" &&
    EQUALITY_OPERATORS.has(value.operator) &&
    isBoundedEquality(value, graph, constraints)
  )
    return !NEGATED_EQUALITY_OPERATORS.has(value.operator);
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

const getDerivedValues = (
  derived: DerivedString | DerivedCall,
  constraints: Constraints,
): AbstractValue[] | null => {
  if ("operands" in derived) return getCallValues(derived, constraints);
  const receiverValues = getPossibleValues(derived.receiver, constraints);
  if (!receiverValues) return null;
  const results: AbstractValue[] = [];
  for (const receiverValue of receiverValues) {
    if (receiverValue.kind !== "Literal" || typeof receiverValue.value !== "string") return null;
    results.push({
      kind: "Literal",
      value: applyStringMethod(derived.method, receiverValue.value, derived.argumentValues),
    });
  }
  return dedupeAbstractValues(results);
};

const getLengthCases = (value: BindingValue, constraints: Constraints): AbstractValue[] | null => {
  if (value.path.at(-1) !== LENGTH_FIELD) return null;
  const ownerValues = getPossibleValues({ ...value, path: value.path.slice(0, -1) }, constraints);
  if (!ownerValues || ownerValues.length === 0) return null;
  const lengths: AbstractValue[] = [];
  for (const ownerValue of ownerValues) {
    if (ownerValue.kind !== "Literal" || typeof ownerValue.value !== "string") return null;
    lengths.push({ kind: "Literal", value: ownerValue.value.length });
  }
  return dedupeAbstractValues(lengths);
};

export const getPossibleValues = (
  value: SymbolicValue,
  constraints: Constraints,
): AbstractValue[] | null => {
  if (value.kind !== "Binding") return null;
  const { derived } = value.binding;
  const derivedValues =
    derived && value.path.length === 0 ? getDerivedValues(derived, constraints) : null;
  return (
    derivedValues ??
    getLengthCases(value, constraints) ??
    constraints.possibleValues.get(getValuePlace(value)) ??
    null
  );
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

const distributeComparison = memoizeByIdentity((value: SymbolicValue): ConditionalValue | null => {
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
});

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

const mayBeNaN = (candidate: AbstractValue): boolean =>
  candidate.kind === "Literal"
    ? typeof candidate.value === "number"
    : candidate.primitive === "number" || candidate.primitive === null;

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
      if (ORDER_OPERATORS.has(value.operator)) return evaluateComparison(value, constraints);
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

export const joinConstraints = (left: Constraints, right: Constraints): Constraints => {
  const rightBoundKeys = new Set(right.bounds.map(formatBound));
  return {
    possibleValues: joinPlaceValues(left.possibleValues, right.possibleValues),
    assumptions: new Map(
      [...left.assumptions].filter(
        ([key, assumption]) => right.assumptions.get(key)?.isTrue === assumption.isTrue,
      ),
    ),
    bounds: left.bounds.filter((bound) => rightBoundKeys.has(formatBound(bound))),
    boundGraph: null,
    invariants: left.invariants,
    finitePlaces: left.finitePlaces,
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
  if (value.kind === "Binding") {
    const assumed = getPossibleValues(value, constraints)
      ? assumeByNarrowing(value, isTrue, value, constraints, (candidate) =>
          narrowTruthiness(candidate, isTrue),
        )
      : assumeOpaqueCondition(value, isTrue, constraints);
    return assumed && withStringLengthBounds(value, isTrue, assumed);
  }
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
  value.kind === "Literal" ? typeof value.value === "string" : value.primitive === "string";

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
): Constraints => {
  const assumed = cloneConstraints(constraints);
  assumed.possibleValues.set(getValuePlace(bindingValue), [{ kind: "Literal", value: literal }]);
  return assumed;
};

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
  const assumedBounds = getBounds(value, isTrue, constraints);
  if (assumedBounds) {
    addBounds(assumed, assumedBounds);
    if (!isConsistent(getBoundGraph(assumed))) return null;
  }
  return assumed;
};

export const addBounds = (constraints: Constraints, bounds: Bound[]): void => {
  if (bounds.length === 0) return;
  constraints.boundGraph = bounds.reduce(withBound, getBoundGraph(constraints));
  constraints.bounds.push(...bounds);
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
  constraints.boundGraph = null;
};

export const dedupeAbstractValues = (values: AbstractValue[]): AbstractValue[] => [
  ...new Map(values.map((value) => [formatAbstractValue(value), value])).values(),
];

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

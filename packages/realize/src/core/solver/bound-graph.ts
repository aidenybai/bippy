import type {
  AbstractValue,
  BinaryExpressionValue,
  BinaryOperator,
  BindingValue,
  BindingPlace,
  Domain,
  SymbolicValue,
} from "../types";
import type { Constraints } from "./constraints";
import {
  BOUND_OPERATORS,
  EQUALITY_OPERATORS,
  NEGATED_EQUALITY_OPERATORS,
  ORDER_OPERATORS,
} from "./comparison-operators";
import { getDomainPrimitive } from "../type-checker/domains";
import type { PlaceMap } from "../values/place-map";
import { getPlaceKey } from "../values/get-place-key";
import { getValuePlace } from "../values/get-value-place";
import { isSamePlace } from "../values/is-same-place";
import { foldBinary, foldUnary } from "../values/symbolic-values";
import { getNegatedOperator } from "./get-negated-operator";
import { memoizeByIdentity } from "../shared/memoize-by-identity";
import { getNextDown } from "./get-next-down";
import { getLeastFloat } from "./get-least-float";

const CONSTANT_KEY = "#";
export const LENGTH_FIELD = "length";

export interface Bound {
  left: BindingPlace | null;
  right: BindingPlace | null;
  maxDifference: number;
  isStrict: boolean;
  mayBeNaN?: boolean;
}

interface AtomDifference {
  plus: BindingPlace | null;
  minus: BindingPlace | null;
}

interface Distance {
  weight: number;
  isStrict: boolean;
}

export interface BoundGraph {
  indicesByAtomKey: Map<string, number>;
  distances: Distance[][];
  placeDomains: PlaceMap<Domain>;
}

export const getAtomKey = (atom: BindingPlace | null): string =>
  atom ? getPlaceKey(atom) : CONSTANT_KEY;

interface SignedAtom {
  atom: BindingPlace;
  isPlus: boolean;
}

interface SignedSum {
  atoms: SignedAtom[];
  offset: number;
}

const MAX_SUM_ATOMS = 2;

const negateSum = ({ atoms, offset }: SignedSum): SignedSum => ({
  atoms: atoms.map(({ atom, isPlus }) => ({ atom, isPlus: !isPlus })),
  offset: -offset,
});

const getSignedSum = (value: SymbolicValue): SignedSum | null => {
  if (value.kind === "Primitive")
    return typeof value.value === "number" ? { atoms: [], offset: value.value } : null;
  if (value.kind === "Binding")
    return { atoms: [{ atom: getValuePlace(value), isPlus: true }], offset: 0 };
  if (value.kind === "UnaryExpression" && value.operator === "-") {
    const operand = getSignedSum(value.value);
    return operand && negateSum(operand);
  }
  if (value.kind !== "BinaryExpression" || (value.operator !== "+" && value.operator !== "-"))
    return null;
  const left = getSignedSum(value.left);
  const right = getSignedSum(value.right);
  if (!left || !right) return null;
  const added = value.operator === "+" ? right : negateSum(right);
  const atoms = [...left.atoms, ...added.atoms];
  return atoms.length > MAX_SUM_ATOMS ? null : { atoms, offset: left.offset + added.offset };
};

const hasArithmetic = (value: SymbolicValue): boolean =>
  value.kind === "BinaryExpression" ||
  (value.kind === "UnaryExpression" && hasArithmetic(value.value));

const hasOffset = (value: SymbolicValue): boolean =>
  (value.kind === "Primitive" && value.value !== 0) ||
  (value.kind === "UnaryExpression" && hasOffset(value.value)) ||
  (value.kind === "BinaryExpression" && (hasOffset(value.left) || hasOffset(value.right)));

const getAtomSum = (value: SymbolicValue, atomValue: number): SymbolicValue => {
  if (value.kind === "UnaryExpression")
    return foldUnary(value.operator, getAtomSum(value.value, atomValue));
  if (value.kind === "BinaryExpression")
    return foldBinary(
      value.operator,
      getAtomSum(value.left, atomValue),
      getAtomSum(value.right, atomValue),
    );
  return value.kind === "Binding" ? { kind: "Primitive", value: atomValue } : value;
};

const getRoundedBounds = (
  value: BinaryExpressionValue,
  operator: BinaryOperator,
  atom: BindingPlace,
  isIncreasing: boolean,
): Bound[] | null => {
  const parts: BinaryOperator[] = EQUALITY_OPERATORS.has(operator) ? [">=", "<="] : [operator];
  const bounds = parts.map((part) => {
    const isIncluded = (atomValue: number): boolean => {
      const folded = foldBinary(
        part,
        getAtomSum(value.left, atomValue),
        getAtomSum(value.right, atomValue),
      );
      return folded.kind === "Primitive" && folded.value === true;
    };
    const isUpward = (part === ">" || part === ">=") === isIncreasing;
    const least = isUpward
      ? getLeastFloat(isIncluded)
      : getLeastFloat((atomValue) => isIncluded(-atomValue));
    if (least === null || !Number.isFinite(least)) return null;
    return isUpward
      ? { left: null, right: atom, maxDifference: -least, isStrict: false }
      : { left: atom, right: null, maxDifference: -least, isStrict: false };
  });
  return bounds.every((bound) => bound !== null) ? bounds : null;
};

const getAtomDifference = (left: SignedSum, right: SignedSum): AtomDifference | null => {
  const signedAtoms = [...left.atoms, ...negateSum(right).atoms];
  const remaining = signedAtoms.filter(
    (signed) =>
      !signedAtoms.some(
        (other) => other.isPlus !== signed.isPlus && isSamePlace(other.atom, signed.atom),
      ),
  );
  const plus = remaining.flatMap(({ atom, isPlus }) => (isPlus ? [atom] : []));
  const minus = remaining.flatMap(({ atom, isPlus }) => (isPlus ? [] : [atom]));
  if (plus.length > 1 || minus.length > 1 || plus.length + minus.length === 0) return null;
  return { plus: plus[0] ?? null, minus: minus[0] ?? null };
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

const hasLength = (value: AbstractValue): boolean =>
  value.kind === "Literal"
    ? typeof value.value === "string"
    : value.kind === "Type" && (value.primitive === null || value.primitive === "string");

const isLengthAtom = (atom: BindingPlace, constraints: Constraints): boolean => {
  if (atom.path.at(-1) !== LENGTH_FIELD) return false;
  const owner = constraints.placeDomains.get({ ...atom, path: atom.path.slice(0, -1) });
  const length = constraints.placeDomains.get(atom);
  return (
    owner?.kind !== "Unknown" &&
    (owner?.kind !== "Cases" || owner.cases.every(hasLength)) &&
    (length === undefined || getDomainPrimitive(length) === "number")
  );
};

export const isNumberAtom = (atom: BindingPlace, constraints: Constraints): boolean =>
  isLengthAtom(atom, constraints) ||
  everyCase(
    atom,
    constraints,
    (value) =>
      value.kind === "Literal" && typeof value.value === "number" && !Number.isNaN(value.value),
  ) ||
  appearsIn(
    atom,
    [...constraints.invariants, ...constraints.bounds].filter((bound) => !bound.mayBeNaN),
  );

const isNumericAtom = (atom: BindingPlace, constraints: Constraints): boolean =>
  isLengthAtom(atom, constraints) ||
  everyCase(atom, constraints, (value) =>
    value.kind === "Literal"
      ? typeof value.value === "number"
      : value.kind === "Type" && value.primitive === "number",
  ) ||
  appearsIn(atom, constraints.invariants);

const isNumberTyped = (value: SymbolicValue, constraints: Constraints): boolean => {
  if (value.kind === "Primitive") return typeof value.value === "number";
  if (value.kind === "UnaryExpression") return value.operator === "-";
  if (value.kind === "BinaryExpression")
    return (
      value.operator === "-" ||
      (isNumberTyped(value.left, constraints) && isNumberTyped(value.right, constraints))
    );
  if (value.kind !== "Binding") return false;
  const place = getValuePlace(value);
  const domain =
    value.path.length === 0 ? value.binding.domain : constraints.placeDomains.get(place);
  return (
    (domain !== undefined && getDomainPrimitive(domain) === "number") ||
    isNumericAtom(place, constraints)
  );
};

const isArithmetic = (value: SymbolicValue, constraints: Constraints): boolean => {
  if (value.kind === "UnaryExpression") return isArithmetic(value.value, constraints);
  if (value.kind !== "BinaryExpression") return true;
  return (
    (value.operator !== "+" ||
      (isNumberTyped(value.left, constraints) && isNumberTyped(value.right, constraints))) &&
    isArithmetic(value.left, constraints) &&
    isArithmetic(value.right, constraints)
  );
};

const isFiniteAtom = (atom: BindingPlace, constraints: Constraints): boolean =>
  isLengthAtom(atom, constraints) ||
  everyCase(
    atom,
    constraints,
    (value) =>
      value.kind === "Literal" && typeof value.value === "number" && Number.isFinite(value.value),
  ) ||
  constraints.finitePlaces.has(atom);

const getIntegerMagnitude = (value: SymbolicValue, constraints: Constraints): number | null => {
  if (value.kind === "Primitive")
    return Number.isSafeInteger(value.value) ? Math.abs(Number(value.value)) : null;
  if (value.kind === "UnaryExpression") return getIntegerMagnitude(value.value, constraints);
  if (value.kind === "BinaryExpression") {
    const left = getIntegerMagnitude(value.left, constraints);
    const right = getIntegerMagnitude(value.right, constraints);
    return left === null || right === null ? null : left + right;
  }
  if (value.kind !== "Binding") return null;
  const atom = getValuePlace(value);
  if (isLengthAtom(atom, constraints)) return 2 ** 32;
  const cases = constraints.possibleValues.get(atom) ?? [];
  const magnitudes = cases.flatMap((innerCase) =>
    innerCase.kind === "Literal" && Number.isSafeInteger(innerCase.value)
      ? [Math.abs(Number(innerCase.value))]
      : [],
  );
  return magnitudes.length > 0 && magnitudes.length === cases.length
    ? Math.max(...magnitudes)
    : null;
};

const isExactSum = (value: SymbolicValue, constraints: Constraints): boolean => {
  if (!hasArithmetic(value)) return true;
  const magnitude = getIntegerMagnitude(value, constraints);
  return magnitude !== null && magnitude <= Number.MAX_SAFE_INTEGER;
};

const isNumberValue = (value: SymbolicValue, constraints: Constraints): boolean => {
  if (value.kind === "Conditional")
    return (
      isNumberValue(value.consequent, constraints) && isNumberValue(value.alternate, constraints)
    );
  const sum = getSignedSum(value);
  return sum !== null && sum.atoms.every(({ atom }) => isNumberAtom(atom, constraints));
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
  if (
    constraints &&
    !(isArithmetic(value.left, constraints) && isArithmetic(value.right, constraints))
  )
    return null;
  const operator = isTrue ? value.operator : getNegatedOperator(value.operator);
  if (!operator || !BOUND_OPERATORS.has(operator)) return null;
  const leftTerm = getSignedSum(value.left);
  const rightTerm = getSignedSum(value.right);
  const difference = leftTerm && rightTerm && getAtomDifference(leftTerm, rightTerm);
  if (!leftTerm || !rightTerm || !difference) return null;
  const { plus, minus } = difference;
  const offsetDifference = rightTerm.offset - leftTerm.offset;
  const isRounded = hasArithmetic(value.left) || hasArithmetic(value.right);
  const atom = plus ?? minus;
  const atomCount = leftTerm.atoms.length + rightTerm.atoms.length;
  if (isRounded && atom && atomCount === 1)
    return getRoundedBounds(value, operator, atom, plus !== null);
  const isSignExact =
    plus !== null &&
    minus !== null &&
    atomCount === 2 &&
    !hasOffset(value.left) &&
    !hasOffset(value.right);
  const isExact =
    !isRounded ||
    isSignExact ||
    (constraints !== null &&
      isExactSum(value.left, constraints) &&
      isExactSum(value.right, constraints));
  const isSingleRounding =
    plus !== null &&
    minus !== null &&
    atomCount === 2 &&
    Number.isFinite(offsetDifference) &&
    (leftTerm.atoms.length === 0
      ? !hasArithmetic(value.left) && !hasOffset(value.right)
      : rightTerm.atoms.length === 0 && !hasArithmetic(value.right) && !hasOffset(value.left));
  if (!isExact && !isSingleRounding) return null;
  if (constraints !== null && plus !== null && minus !== null) {
    if (!isNumericAtom(plus, constraints) || !isNumericAtom(minus, constraints)) return null;
    const isFinite = isFiniteAtom(plus, constraints) && isFiniteAtom(minus, constraints);
    const isNonStrict = value.operator === ">=" || value.operator === "<=";
    if ((offsetDifference !== 0 || (isRounded && isNonStrict)) && !isFinite) return null;
  }
  const below: Bound = {
    left: plus,
    right: minus,
    maxDifference: isExact ? offsetDifference : -getNextDown(-offsetDifference),
    isStrict: !isExact,
  };
  const above: Bound = {
    left: minus,
    right: plus,
    maxDifference: isExact ? -offsetDifference : -getNextDown(offsetDifference),
    isStrict: !isExact,
  };
  switch (operator) {
    case "<":
      return [{ ...below, maxDifference: offsetDifference, isStrict: true }];
    case "<=":
      return [below];
    case ">":
      return [{ ...above, maxDifference: -offsetDifference, isStrict: true }];
    case ">=":
      return [above];
    default:
      return [below, above];
  }
};

const isShorter = (candidate: Distance, current: Distance): boolean =>
  candidate.weight < current.weight ||
  (candidate.weight === current.weight && candidate.isStrict && !current.isStrict);

const UNREACHABLE: Distance = { weight: Infinity, isStrict: false };

const getUpperSum = (left: number, right: number): number => {
  const sum = left + right;
  if (!Number.isFinite(sum)) return sum;
  const rightPart = sum - left;
  const error = left - (sum - rightPart) + (right - rightPart);
  return error > 0 ? -getNextDown(-sum) : sum;
};

const SELF: Distance = { weight: 0, isStrict: false };

const createEmptyGraph = (placeDomains: PlaceMap<Domain>): BoundGraph => ({
  indicesByAtomKey: new Map([[CONSTANT_KEY, 0]]),
  distances: [[SELF]],
  placeDomains,
});

const isNonNegativeLength = (atom: BindingPlace, placeDomains: PlaceMap<Domain>): boolean => {
  if (atom.path.at(-1) !== LENGTH_FIELD) return false;
  const owner = placeDomains.get({ ...atom, path: atom.path.slice(0, -1) });
  return owner?.kind !== "Opaque" || !owner.hasOwnLength;
};

const getLengthBound = (atom: BindingPlace | null, placeDomains: PlaceMap<Domain>): Bound | null =>
  atom && isNonNegativeLength(atom, placeDomains)
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
    placeDomains: graph.placeDomains,
  };
  const lengthBound = getLengthBound(atom, graph.placeDomains);
  return lengthBound ? withBound(grown, lengthBound) : grown;
};

const withBound = (graph: BoundGraph, bound: Bound): BoundGraph => {
  const { indicesByAtomKey, distances, placeDomains } = withAtom(
    withAtom(graph, bound.left),
    bound.right,
  );
  const from = indicesByAtomKey.get(getAtomKey(bound.right)) ?? 0;
  const to = indicesByAtomKey.get(getAtomKey(bound.left)) ?? 0;
  const edge: Distance = { weight: bound.maxDifference, isStrict: bound.isStrict };
  if (!isShorter(edge, distances[from][to])) return { indicesByAtomKey, distances, placeDomains };
  const fromRow = distances[to];
  return {
    indicesByAtomKey,
    placeDomains,
    distances: distances.map((row) => {
      const toEdge = row[from];
      if (toEdge.weight === Infinity) return row;
      return row.map((current, columnIndex) => {
        const fromEdge = fromRow[columnIndex];
        if (fromEdge.weight === Infinity) return current;
        const throughEdge: Distance = {
          weight: getUpperSum(getUpperSum(toEdge.weight, edge.weight), fromEdge.weight),
          isStrict: toEdge.isStrict || edge.isStrict || fromEdge.isStrict,
        };
        return isShorter(throughEdge, current) ? throughEdge : current;
      });
    }),
  };
};

export const isConsistent = (graph: BoundGraph): boolean =>
  graph.distances.every((row, atomIndex) => {
    const cycle = row[atomIndex];
    return !(cycle.weight < 0 || (cycle.weight === 0 && cycle.isStrict));
  });

const getSubgraph = (graph: BoundGraph, bounds: Bound[]): BoundGraph => {
  const atomKeys = new Set([CONSTANT_KEY]);
  for (const bound of bounds) {
    atomKeys.add(getAtomKey(bound.left));
    atomKeys.add(getAtomKey(bound.right));
  }
  const indices = [...atomKeys].flatMap((atomKey): [string, number][] => {
    const index = graph.indicesByAtomKey.get(atomKey);
    return index === undefined ? [] : [[atomKey, index]];
  });
  return {
    indicesByAtomKey: new Map(indices.map(([atomKey], position) => [atomKey, position])),
    distances: indices.map(([, fromIndex]) =>
      indices.map(([, toIndex]) => graph.distances[fromIndex][toIndex]),
    ),
    placeDomains: graph.placeDomains,
  };
};

const isConsistentWith = (graph: BoundGraph, bounds: Bound[]): boolean => {
  if (!isConsistent(graph)) return false;
  const [bound] = bounds;
  const from = bound && graph.indicesByAtomKey.get(getAtomKey(bound.right));
  const to = bound && graph.indicesByAtomKey.get(getAtomKey(bound.left));
  if (bounds.length !== 1 || !bound || from === undefined || to === undefined)
    return isConsistent(bounds.reduce(withBound, getSubgraph(graph, bounds)));
  const back = graph.distances[to][from];
  const cycleWeight = getUpperSum(back.weight, bound.maxDifference);
  return !(cycleWeight < 0 || (cycleWeight === 0 && (back.isStrict || bound.isStrict)));
};

const getInvariantGraphs = memoizeByIdentity((placeDomains: PlaceMap<Domain>) =>
  memoizeByIdentity((invariants: Bound[]): BoundGraph =>
    invariants.reduce(withBound, createEmptyGraph(placeDomains)),
  ),
);

export const getBoundGraph = (constraints: Constraints): BoundGraph =>
  (constraints.boundGraph ??= constraints.bounds.reduce(
    withBound,
    getInvariantGraphs(constraints.placeDomains)(constraints.invariants),
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
    isNumberValue(value.left, constraints) &&
    isNumberValue(value.right, constraints) &&
    isNumberTyped(value.left, constraints) &&
    isNumberTyped(value.right, constraints) &&
    !isConsistentWith(graph, below) &&
    !isConsistentWith(graph, above)
  );
};

export const evaluateBounds = (value: SymbolicValue, constraints: Constraints): boolean | null => {
  if (constraints.invariants.length === 0 && constraints.bounds.length === 0) return null;
  const graph = getBoundGraph(constraints);
  const whenTrue = getBounds(value, true, constraints);
  const whenFalse = getBounds(value, false, constraints);
  if (whenTrue && !isConsistentWith(graph, whenTrue)) return false;
  if (whenFalse && !isConsistentWith(graph, whenFalse)) return true;
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

export const evaluateNonZero = (value: BindingValue, constraints: Constraints): boolean | null => {
  const place = getValuePlace(value);
  const isBounded = [...constraints.invariants, ...constraints.bounds].some((bound) =>
    [bound.left, bound.right].some((atom) => atom !== null && isSamePlace(atom, place)),
  );
  if (!isBounded) return null;
  const isPositive = compareWithZero(value, ">", constraints);
  const isNegative = compareWithZero(value, "<", constraints);
  if (isPositive || isNegative) return true;
  return isPositive === false && isNegative === false && isNumberTyped(value, constraints)
    ? false
    : null;
};

export const addBounds = (constraints: Constraints, bounds: Bound[]): void => {
  if (bounds.length === 0) return;
  constraints.boundGraph = bounds.reduce(withBound, getBoundGraph(constraints));
  constraints.bounds = [...constraints.bounds, ...bounds];
};

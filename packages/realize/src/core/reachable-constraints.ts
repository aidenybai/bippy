import { getBindingUpdates } from "./collect-handlers";
import { addBounds, dedupeAbstractValues, evaluateCondition, getLengthAtom } from "./constraints";
import type { Bound, Constraints } from "./constraints";
import { decideGuards, getFieldCases } from "./field-cases";
import { getReachableIntegers, getReachableRange } from "./reachable-ranges";
import type {
  AbstractValue,
  Binding,
  BindingPlace,
  ComponentAnalysis,
  Domain,
  NumberRange,
  PrimitiveValue,
  StateUpdate,
  SymbolicValue,
} from "./types";
import { foldBinary, foldUnary } from "./symbolic-values";
import { applyPureFunction } from "./utils/pure-functions";
import { appendToGroup } from "./utils/append-to-group";
import { applyStringMethod } from "./utils/string-methods";
import {
  applyArrayMethod,
  applyCollectionMethod,
  getCollectionCases,
} from "./utils/literal-receivers";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getBindingPlace } from "./utils/get-binding-place";
import { getTruthiness } from "./utils/get-truthiness";
import { getTestExpression } from "./utils/get-test-expression";
import { getValuePlace } from "./utils/get-value-place";
import { isNullish } from "./utils/is-nullish";
import { isSamePlace } from "./utils/is-same-place";
import { isStateBinding } from "./utils/is-state-binding";
import { isWholeBinding } from "./utils/is-whole-binding";
import { PlaceMap } from "./utils/place-map";
import type { FirstRenderOutcomes } from "./state-enumerator";

const MAX_REACHABILITY_ROUNDS = 8;
const MAX_REACHABLE_CASES = 256;

export type ReachablePlaces = Map<number, Array<[BindingPlace, AbstractValue[]]>>;

export interface ReachabilityContext {
  analysis: ComponentAnalysis;
  reachableConstraints: Constraints;
  reachablePlacesByBinding: ReachablePlaces;
  dependentsByBinding: Map<number, number[]>;
}

export const getReachablePlacesByBinding = (reachableConstraints: Constraints): ReachablePlaces => {
  const placesByBinding: ReachablePlaces = new Map();
  for (const entry of reachableConstraints.possibleValues)
    appendToGroup(placesByBinding, entry[0].bindingId, entry);
  return placesByBinding;
};

export const getToggleCases = (
  value: SymbolicValue,
  place: BindingPlace,
  currentValues: AbstractValue[] | undefined,
): AbstractValue[] | null => {
  if (
    !currentValues ||
    value.kind !== "UnaryExpression" ||
    value.operator !== "!" ||
    value.value.kind !== "Binding"
  )
    return null;
  if (!isSamePlace(getValuePlace(value.value), place)) return null;
  return currentValues.map((currentValue): AbstractValue => ({
    kind: "Literal",
    value: getTruthiness(currentValue) === "falsy",
  }));
};

const substitutePlace = (
  value: SymbolicValue,
  place: BindingPlace,
  current: PrimitiveValue,
): SymbolicValue | null => {
  switch (value.kind) {
    case "Primitive":
      return value;
    case "Binding": {
      if (isSamePlace(getValuePlace(value), place)) return { kind: "Primitive", value: current };
      const { derived } = value.binding;
      if (value.path.length === 0 && derived !== null && "operands" in derived) {
        const operands = derived.operands.map((operand) =>
          substitutePlace(operand, place, current),
        );
        const primitives = operands.flatMap((operand) =>
          operand?.kind === "Primitive" ? [operand.value] : [],
        );
        const result =
          primitives.length === operands.length
            ? applyPureFunction(derived.callee, primitives)
            : null;
        return result === null ? null : { kind: "Primitive", value: result };
      }
      const isDerivedFromPlace =
        value.path.length === 0 &&
        derived !== null &&
        "receiver" in derived &&
        isSamePlace(getValuePlace(derived.receiver), place);
      return isDerivedFromPlace && typeof current === "string"
        ? {
            kind: "Primitive",
            value: applyStringMethod(derived.method, current, derived.argumentValues),
          }
        : null;
    }
    case "UnaryExpression": {
      const operand = substitutePlace(value.value, place, current);
      return operand ? foldUnary(value.operator, operand) : null;
    }
    case "BinaryExpression": {
      const left = substitutePlace(value.left, place, current);
      const right = substitutePlace(value.right, place, current);
      return left && right ? foldBinary(value.operator, left, right) : null;
    }
    default:
      return null;
  }
};

export const getSelfCases = (
  value: SymbolicValue,
  place: BindingPlace,
  currentValues: AbstractValue[] | undefined,
): AbstractValue[] | null => {
  const results: AbstractValue[] = [];
  for (const currentValue of currentValues ?? []) {
    if (currentValue.kind !== "Literal") return null;
    if (typeof currentValue.value !== "string" && typeof currentValue.value !== "number")
      return null;
    const result = substitutePlace(value, place, currentValue.value);
    if (result?.kind !== "Primitive") return null;
    results.push({ kind: "Literal", value: result.value });
  }
  return results.length > 0 ? results : null;
};

const getCollectionUpdateCases = (
  value: SymbolicValue,
  place: BindingPlace,
  currentValues: AbstractValue[],
  analysis: ComponentAnalysis,
): AbstractValue[] | null => {
  if (value.kind !== "Collection" || place.path.length > 0) return null;
  const guardConstraints = createEmptyConstraints(analysis, new Map());
  return getCollectionCases(value, {
    read: (source) => (isSamePlace(getValuePlace(source), place) ? currentValues : null),
    decide: (guards, owner) => decideGuards(guards, guardConstraints, owner),
  });
};

const hasCastPart = (value: SymbolicValue): boolean => {
  let isCast = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Unknown" && part.reason === "cast") isCast = true;
  });
  return isCast;
};

const NON_NULLISH_KINDS = new Set<SymbolicValue["kind"]>([
  "ObjectExpression",
  "ArrayExpression",
  "Function",
  "JsxExpression",
  "JsxFragment",
]);

const getNonNullishCases = (typeCases: AbstractValue[] | null): AbstractValue[] | null => {
  const cases = typeCases?.filter((value) => value.kind !== "Literal" || !isNullish(value.value));
  return cases && cases.length > 0 ? cases : null;
};

const getFirstRenderTarget = (
  value: SymbolicValue,
  path: string[],
  constraints: Constraints,
): SymbolicValue | null => {
  if (value.kind === "Conditional") {
    const outcome = evaluateCondition(getTestExpression(value), constraints);
    return outcome === null
      ? null
      : getFirstRenderTarget(outcome ? value.consequent : value.alternate, path, constraints);
  }
  const [field, ...restPath] = path;
  if (field === undefined) return value;
  const fieldValue =
    value.kind === "ArrayExpression" && value.spreads.length === 0
      ? value.elements[Number(field)]
      : value.kind === "ObjectExpression" && value.spreads.length === 0
        ? value.properties.findLast((property) => property.key === field)?.value
        : undefined;
  return fieldValue ? getFirstRenderTarget(fieldValue, restPath, constraints) : null;
};

const getValueCases = (
  value: SymbolicValue | null,
  path: string[],
  binding: Binding,
  constraints: Constraints | null,
  typeCases: AbstractValue[] | null,
  isFirstRender = false,
): ReturnType<typeof getFieldCases> => {
  const fieldCases = getFieldCases(value, path, binding, constraints, isFirstRender);
  if (fieldCases !== null || value === null) return fieldCases;
  const target =
    isFirstRender && constraints
      ? getFirstRenderTarget(value, path, constraints)
      : path.length === 0
        ? value
        : null;
  return target && NON_NULLISH_KINDS.has(target.kind) ? getNonNullishCases(typeCases) : null;
};

const MAX_SHORTENED_LENGTH = 32;

const getShortenedLengths = (
  value: SymbolicValue,
  place: BindingPlace,
  reachable: AbstractValue[],
): AbstractValue[] | "unchanged" | null => {
  const limit = value.kind === "Binding" ? value.binding.lengthLimit : null;
  if (
    !limit ||
    value.kind !== "Binding" ||
    value.path.length > 0 ||
    !isSamePlace(limit.arrayLength, place)
  )
    return null;
  if (limit.isSameLength) return "unchanged";
  const lengths = reachable.flatMap((length) =>
    length.kind === "Literal" &&
    typeof length.value === "number" &&
    Number.isInteger(length.value) &&
    length.value >= 0
      ? [length.value]
      : [],
  );
  if (lengths.length === 0 || lengths.length !== reachable.length) return null;
  const longest = Math.max(...lengths);
  if (longest > MAX_SHORTENED_LENGTH) return null;
  return Array.from({ length: longest + 1 }, (_unused, count) => ({
    kind: "Literal",
    value: count,
  }));
};

const readsOnlyPlace = (guard: SymbolicValue, place: BindingPlace): boolean => {
  let readsPlace = false;
  let readsOther = false;
  forEachSymbolicValue(guard, (part) => {
    if (part.kind === "Unknown") readsOther = true;
    if (part.kind !== "Binding") return;
    if (isSamePlace(getValuePlace(part), place)) readsPlace = true;
    if (!isSamePlace(getValuePlace(part), place)) readsOther = true;
  });
  return readsPlace && !readsOther;
};

const isGuardedOff = (
  update: StateUpdate,
  place: BindingPlace,
  reachable: AbstractValue[],
  analysis: ComponentAnalysis,
): boolean => {
  if (!update.guards.some((guard) => readsOnlyPlace(guard, place))) return false;
  const constraints = createEmptyConstraints(analysis, new Map());
  constraints.possibleValues.set(place, reachable);
  return update.guards.some(
    (guard) => readsOnlyPlace(guard, place) && evaluateCondition(guard, constraints) === false,
  );
};

const getReachableCases = (
  analysis: ComponentAnalysis,
  binding: Binding,
  path: string[],
  domain: Domain,
  mount: Constraints,
): AbstractValue[] | null => {
  const typeCases = domain.kind === "Cases" ? domain.cases : null;
  const updates = getBindingUpdates(analysis.handlers, binding);
  const isUntypedState =
    typeCases?.every((value) => value.kind === "Literal" && isNullish(value.value)) ?? false;
  if (isUntypedState && updates.length > 0) return null;
  if (updates.some((update) => hasCastPart(update.value))) return null;
  const initialCases = getValueCases(binding.initial, path, binding, mount, typeCases);
  if (!Array.isArray(initialCases)) return typeCases;
  mount.possibleValues.set(getBindingPlace(binding, path), dedupeAbstractValues(initialCases));
  let reachable = dedupeAbstractValues(initialCases);
  const place = getBindingPlace(binding, path);
  for (let round = 0; round < MAX_REACHABILITY_ROUNDS; round++) {
    const previousCount = reachable.length;
    for (const update of updates) {
      if (isGuardedOff(update, place, reachable, analysis)) continue;
      const updateCases =
        getValueCases(update.value, path, binding, null, typeCases) ??
        getToggleCases(update.value, place, reachable) ??
        getSelfCases(update.value, place, reachable) ??
        getCollectionUpdateCases(update.value, place, reachable, analysis) ??
        getShortenedLengths(update.value, place, reachable);
      if (updateCases === "unchanged") continue;
      if (!updateCases) return getReachableIntegers(binding, analysis.handlers) ?? typeCases;
      reachable = dedupeAbstractValues([...reachable, ...updateCases]);
      if (reachable.length > MAX_REACHABLE_CASES)
        return getReachableIntegers(binding, analysis.handlers) ?? typeCases;
    }
    if (reachable.length === previousCount) return reachable;
  }
  return getReachableIntegers(binding, analysis.handlers) ?? typeCases;
};

const getLengthLimitBounds = (binding: Binding): Bound[] => {
  if (!binding.lengthLimit) return [];
  const { arrayLength, isSameLength } = binding.lengthLimit;
  const resultLength = getLengthAtom(binding.id);
  const isNoLonger: Bound = {
    left: resultLength,
    right: arrayLength,
    maxDifference: 0,
    isStrict: false,
  };
  const isNoShorter: Bound = {
    left: arrayLength,
    right: resultLength,
    maxDifference: 0,
    isStrict: false,
  };
  return isSameLength ? [isNoLonger, isNoShorter] : [isNoLonger];
};

const getReachableRanges = (analysis: ComponentAnalysis): Map<number, NumberRange> =>
  new Map(
    analysis.bindings.flatMap((binding): Array<[number, NumberRange]> => {
      const range =
        binding.range === null && isStateBinding(binding)
          ? getReachableRange(binding, analysis.handlers)
          : null;
      return range ? [[binding.id, range]] : [];
    }),
  );

const createEmptyConstraints = (
  analysis: ComponentAnalysis,
  reachableRanges: Map<number, NumberRange>,
): Constraints => ({
  possibleValues: new PlaceMap<AbstractValue[]>(),
  assumptions: new Map(),
  bounds: [],
  boundGraph: null,
  invariants: analysis.bindings.flatMap((binding) => [
    ...getLengthLimitBounds(binding),
    ...getRangeBounds(
      getBindingPlace(binding),
      binding.range ?? reachableRanges.get(binding.id) ?? null,
    ),
  ]),
  finitePlaces: new PlaceMap(
    analysis.bindings
      .filter((binding) => reachableRanges.has(binding.id))
      .map((binding): [BindingPlace, true] => [getBindingPlace(binding), true]),
  ),
  unionMemberValues: analysis.unionMemberValues,
  possibleMembers: new Map(),
});

export const createInitialConstraints = (analysis: ComponentAnalysis): Constraints => {
  const reachableRanges = getReachableRanges(analysis);
  const reachable = createEmptyConstraints(analysis, reachableRanges);
  const mount = createEmptyConstraints(analysis, reachableRanges);
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  for (const [place, domain] of analysis.placeDomains) {
    const binding = bindingsById.get(place.bindingId);
    const cases =
      binding && isStateBinding(binding)
        ? getReachableCases(analysis, binding, place.path, domain, mount)
        : domain.kind === "Cases"
          ? domain.cases
          : null;
    if (cases) {
      reachable.possibleValues.set(place, cases);
      if (!mount.possibleValues.has(place)) mount.possibleValues.set(place, cases);
    }
  }
  for (const place of analysis.placeDomains.places()) {
    const binding = bindingsById.get(place.bindingId);
    const owner = { ...place, path: place.path.slice(0, -1) };
    const isUnknownLength =
      place.path.at(-1) === "length" &&
      owner.path.length === 0 &&
      binding !== undefined &&
      isStateBinding(binding) &&
      !reachable.possibleValues.has(place);
    if (!isUnknownLength) continue;
    const ownerCases =
      reachable.possibleValues.get(owner) ??
      getReachableCases(
        analysis,
        binding,
        [],
        analysis.placeDomains.get(owner) ?? binding.domain,
        mount,
      );
    const lengths = ownerCases?.map((value) =>
      value.kind === "Literal" && typeof value.value === "string" ? value.value.length : null,
    );
    if (!lengths || lengths.some((length) => length === null)) continue;
    const lengthCases = dedupeAbstractValues(
      lengths.map((length): AbstractValue => ({ kind: "Literal", value: length })),
    );
    reachable.possibleValues.set(place, lengthCases);
    if (!mount.possibleValues.has(place)) mount.possibleValues.set(place, lengthCases);
  }
  return reachable;
};

const getFirstValue = (
  binding: Binding,
  bindingsById: Map<number, Binding>,
  visited = new Set<number>(),
): SymbolicValue | null => {
  const { initial } = binding;
  if (initial?.kind !== "Binding" || initial.path.length > 0 || visited.has(binding.id))
    return initial;
  const source = bindingsById.get(initial.binding.id);
  return source && isStateBinding(source)
    ? getFirstValue(source, bindingsById, visited.add(binding.id))
    : initial;
};

const getFirstMethodValue = (
  binding: Binding,
  bindingsById: Map<number, Binding>,
): PrimitiveValue | null => {
  const { derived } = binding;
  if (!derived || "operands" in derived || derived.receiver.path.length > 0) return null;
  const receiver = bindingsById.get(derived.receiver.binding.id);
  const firstValue =
    receiver && isStateBinding(receiver) ? getFirstValue(receiver, bindingsById) : null;
  if (firstValue?.kind === "Collection")
    return applyCollectionMethod(firstValue, derived.method, derived.argumentValues);
  if (firstValue?.kind !== "ArrayExpression" || firstValue.spreads.length > 0) return null;
  const elements = firstValue.elements.flatMap((element) =>
    element.kind === "Primitive" ? [element.value] : [],
  );
  return elements.length === firstValue.elements.length
    ? applyArrayMethod(derived.method, elements, derived.argumentValues)
    : null;
};

export const createFirstRenderConstraints = (
  analysis: ComponentAnalysis,
  reachableConstraints: Constraints,
): Constraints => {
  const firstRender = {
    ...reachableConstraints,
    possibleValues: reachableConstraints.possibleValues.clone(),
    bounds: [...reachableConstraints.bounds],
  };
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  for (const [place, domain] of analysis.placeDomains) {
    const binding = bindingsById.get(place.bindingId);
    if (!binding?.initial) continue;
    const initialCases = getValueCases(
      getFirstValue(binding, bindingsById),
      place.path,
      binding,
      firstRender,
      domain.kind === "Cases" ? domain.cases : null,
      true,
    );
    if (Array.isArray(initialCases))
      firstRender.possibleValues.set(place, dedupeAbstractValues(initialCases));
  }
  for (const binding of analysis.bindings) {
    const value = getFirstMethodValue(binding, bindingsById);
    if (value !== null)
      firstRender.possibleValues.set(getBindingPlace(binding, []), [{ kind: "Literal", value }]);
  }
  addBounds(
    firstRender,
    analysis.bindings.flatMap((binding) =>
      isStateBinding(binding) && binding.initial ? getLengthBounds(binding.initial, binding) : [],
    ),
  );
  return firstRender;
};

export const getFirstRenderOutcome = (
  firstRender: FirstRenderOutcomes,
  branchKey: string,
  test: SymbolicValue,
): boolean | null => {
  const cachedOutcome = firstRender.outcomesByBranchKey.get(branchKey);
  if (cachedOutcome !== undefined) return cachedOutcome;
  const outcome = evaluateCondition(test, firstRender.constraints);
  firstRender.outcomesByBranchKey.set(branchKey, outcome);
  return outcome;
};

export const isLengthPreserving = (value: SymbolicValue, binding: Binding): boolean => {
  if (value.kind === "ArrayMap") return isWholeBinding(value.array, binding);
  return (
    value.kind === "ArrayExpression" &&
    value.elements.length === 0 &&
    value.spreads.length === 1 &&
    isWholeBinding(value.spreads[0], binding)
  );
};

const getKnownLength = (value: SymbolicValue): { count: number; isExact: boolean } | null => {
  if (value.kind === "ArrayExpression")
    return { count: value.elements.length, isExact: value.spreads.length === 0 };
  if (value.kind === "Primitive" && typeof value.value === "string")
    return { count: value.value.length, isExact: true };
  return null;
};

export const getRangeBounds = (place: BindingPlace, range: NumberRange | null): Bound[] => {
  if (!range) return [];
  const bounds: Bound[] = [];
  if (range.min !== null)
    bounds.push({ left: null, right: place, maxDifference: -range.min, isStrict: false });
  if (range.max !== null)
    bounds.push({ left: place, right: null, maxDifference: range.max, isStrict: false });
  return bounds;
};

export const getUpdateBounds = (value: SymbolicValue, binding: Binding): Bound[] =>
  value.kind === "Binding" && value.path.length === 0
    ? getRangeBounds(getBindingPlace(binding), value.binding.range)
    : getLengthBounds(value, binding);

const isRootAtom = (atom: BindingPlace | null, binding: Binding): boolean =>
  atom !== null && atom.bindingId === binding.id && atom.path.length === 0;

interface AffineUpdate {
  scale: number;
  offset: number;
}

const getFiniteNumber = (value: SymbolicValue): number | null =>
  value.kind === "Primitive" && typeof value.value === "number" && Number.isFinite(value.value)
    ? value.value
    : null;

const getAffineUpdate = (value: SymbolicValue, binding: Binding): AffineUpdate | null => {
  if (isWholeBinding(value, binding)) return { scale: 1, offset: 0 };
  if (value.kind === "UnaryExpression" && value.operator === "-") {
    const operand = getAffineUpdate(value.value, binding);
    return operand && { scale: -operand.scale, offset: -operand.offset };
  }
  if (value.kind !== "BinaryExpression") return null;
  const left = getAffineUpdate(value.left, binding);
  const right = getAffineUpdate(value.right, binding);
  const leftNumber = getFiniteNumber(value.left);
  const rightNumber = getFiniteNumber(value.right);
  if (value.operator === "+" && left && rightNumber !== null)
    return { scale: left.scale, offset: left.offset + rightNumber };
  if (value.operator === "+" && right && leftNumber !== null)
    return { scale: right.scale, offset: right.offset + leftNumber };
  if (value.operator === "-" && left && rightNumber !== null)
    return { scale: left.scale, offset: left.offset - rightNumber };
  if (value.operator === "-" && right && leftNumber !== null)
    return { scale: -right.scale, offset: leftNumber - right.offset };
  if (value.operator === "*" && left && rightNumber !== null && Math.abs(rightNumber) >= 1)
    return { scale: left.scale * rightNumber, offset: left.offset * rightNumber };
  if (value.operator === "*" && right && leftNumber !== null && Math.abs(leftNumber) >= 1)
    return { scale: right.scale * leftNumber, offset: right.offset * leftNumber };
  return null;
};

const shiftBound = (bound: Bound, binding: Binding, update: AffineUpdate): Bound | null => {
  const isUpper = isRootAtom(bound.left, binding) && bound.right === null;
  const isLower = bound.left === null && isRootAtom(bound.right, binding);
  const atom = isUpper ? bound.left : bound.right;
  if ((!isUpper && !isLower) || !atom) return null;
  const limit = update.scale * (isUpper ? bound.maxDifference : -bound.maxDifference);
  const shifted = limit + update.offset;
  if (!Number.isFinite(shifted)) return null;
  return isUpper === update.scale > 0
    ? { left: atom, right: null, maxDifference: shifted, isStrict: bound.isStrict }
    : { left: null, right: atom, maxDifference: -shifted, isStrict: bound.isStrict };
};

const shiftPairBound = (
  bound: Bound,
  binding: Binding,
  update: AffineUpdate,
  updatedBindingIds: ReadonlySet<number>,
): Bound | null => {
  if (update.scale !== 1 || !bound.left || !bound.right) return null;
  const isLeft = isRootAtom(bound.left, binding);
  const other = isLeft ? bound.right : bound.left;
  const isPair = isLeft || isRootAtom(bound.right, binding);
  if (!isPair || other.bindingId === binding.id || updatedBindingIds.has(other.bindingId))
    return null;
  const shifted = bound.maxDifference + (isLeft ? update.offset : -update.offset);
  return Number.isFinite(shifted) ? { ...bound, maxDifference: shifted } : null;
};

export const getShiftedBounds = (
  value: SymbolicValue,
  binding: Binding,
  bounds: Bound[],
  updatedBindingIds: ReadonlySet<number> = new Set([binding.id]),
): Bound[] => {
  const isNumber =
    binding.initial?.kind === "Primitive" && typeof binding.initial.value === "number";
  const update = isNumber ? getAffineUpdate(value, binding) : null;
  if (!update || update.scale === 0 || isWholeBinding(value, binding)) return [];
  return bounds.flatMap(
    (bound) =>
      shiftBound(bound, binding, update) ??
      shiftPairBound(bound, binding, update, updatedBindingIds) ??
      [],
  );
};

const getAppendedCount = (value: SymbolicValue, binding: Binding): number | null => {
  const { initial } = binding;
  if (value.kind === "ArrayExpression" && initial?.kind === "ArrayExpression") {
    const [spread, ...otherSpreads] = value.spreads;
    return spread && otherSpreads.length === 0 && isWholeBinding(spread, binding)
      ? value.elements.length
      : null;
  }
  const isText = initial?.kind === "Primitive" && typeof initial.value === "string";
  const isAppend =
    isText &&
    value.kind === "BinaryExpression" &&
    value.operator === "+" &&
    isWholeBinding(value.left, binding) &&
    value.right.kind === "Primitive" &&
    typeof value.right.value === "string";
  return isAppend && value.right.kind === "Primitive" ? String(value.right.value).length : null;
};

export const getAppendedLengthBounds = (
  value: SymbolicValue,
  binding: Binding,
  bounds: Bound[],
): Bound[] => {
  const count = getAppendedCount(value, binding);
  if (count === null) return [];
  const lengthAtom = getLengthAtom(binding.id);
  return bounds.flatMap((bound): Bound[] => {
    if (bound.left && isSamePlace(bound.left, lengthAtom) && bound.right === null)
      return [{ ...bound, maxDifference: bound.maxDifference + count }];
    if (bound.left === null && bound.right && isSamePlace(bound.right, lengthAtom))
      return [{ ...bound, maxDifference: bound.maxDifference - count }];
    return [];
  });
};

export const getLengthBounds = (value: SymbolicValue, binding: Binding): Bound[] => {
  const known = getKnownLength(value);
  if (!known) return [];
  const lengthAtom = getLengthAtom(binding.id);
  const isAtLeastElementCount: Bound = {
    left: null,
    right: lengthAtom,
    maxDifference: -known.count,
    isStrict: false,
  };
  if (!known.isExact) return [isAtLeastElementCount];
  const isAtMostElementCount: Bound = {
    left: lengthAtom,
    right: null,
    maxDifference: known.count,
    isStrict: false,
  };
  return [isAtLeastElementCount, isAtMostElementCount];
};

export const getDependentsByBinding = (bindings: Binding[]): Map<number, number[]> => {
  const directDependents = new Map<number, number[]>();
  for (const binding of bindings)
    for (const { bindingId } of binding.inputPlaces)
      appendToGroup(directDependents, bindingId, binding.id);
  const collectTransitively = (bindingId: number, collected: Set<number>): Set<number> => {
    for (const dependentId of directDependents.get(bindingId) ?? [])
      if (!collected.has(dependentId)) collectTransitively(dependentId, collected.add(dependentId));
    return collected;
  };
  return new Map(
    [...directDependents.keys()].map((bindingId) => [
      bindingId,
      [...collectTransitively(bindingId, new Set())],
    ]),
  );
};

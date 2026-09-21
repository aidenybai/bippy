import type { SourceLocation } from "../parse/source-types.js";
import type { GuardLiteral, SymbolicPredicate } from "../symbolic/guards.js";
import { parseSymbolicPredicate, serializeSymbolicPredicate } from "../symbolic/serialization.js";
import type {
  Scope,
  StaticBranchValue,
  StaticListValue,
  StaticOptionalValue,
  StaticPrimitive,
  StaticRepeatValue,
  StaticValue,
} from "../types.js";
import { callCallback, callUncertainCallback, type CallbackEvaluator } from "./callbacks.js";
import {
  createCollectionValue,
  getKeyIdentity,
  isDefiniteKey,
  type KeyIdentity,
} from "./collections.js";
import type { EvaluationContext } from "./context.js";
import { createErrorValue } from "./errors.js";
import { hasProperty } from "./has-property.js";
import { getTruthinessPredicate, recordDerivation, recordRepeatSource } from "./predicates.js";
import { joinStrings } from "./primitive-shapes.js";
import { getThrowCertainty } from "./thrown.js";
import { callTypedSet } from "./typed-array-set.js";
import { callBinaryMethod, getBinaryKind, toIndex } from "./typed-arrays.js";
import { isPrimitiveBranch, MAX_DISTRIBUTED_ALTERNATIVES } from "./value-distribution.js";
import {
  branchValue,
  compareIdentity,
  countAlternatives,
  createSymbolValue,
  describeValue,
  FALSE_VALUE,
  getItemValue,
  getListLength,
  getObjectProperty,
  getPreferredTruthiness,
  getPropertyName,
  getTruthiness,
  hasDefiniteItems,
  isCallable,
  isIndefiniteItem,
  isKnownList,
  ITERATOR_PROPERTY_KEY,
  listValue,
  mapFiniteListItems,
  mapValue,
  objectValue,
  optionalValue,
  primitiveValue,
  spreadListItems,
  thrownValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
  widenLoopCarriedValue,
  type CallableValue,
} from "./values.js";

import { MAX_ARRAY_LIKE_LENGTH } from "./array-like.js";

export interface ArrayMethodEvaluator extends CallbackEvaluator {
  resolveIterable: (
    value: StaticValue,
    context: EvaluationContext,
    location: SourceLocation | null,
    iteratorMethod?: StaticValue,
  ) => StaticValue;

  getProperty: (
    receiver: StaticValue,
    key: string,
    context: EvaluationContext,
    location: SourceLocation | null,
  ) => StaticValue;

  recordHeapMutation: (list: StaticListValue) => void;

  callAlternatives: (
    branch: StaticBranchValue,
    context: EvaluationContext,
    call: (alternative: StaticValue, context: EvaluationContext) => StaticValue,
    additionalScope?: Scope,
  ) => StaticValue;
}

/** `flatMap`/`concat` flattening: arrays contribute their items, anything else itself. */
const flattenOneLevel = (value: StaticValue, location: SourceLocation | null): StaticValue[] =>
  spreadListItems(
    mapValue(value, (alternative) =>
      alternative.kind === "list" || alternative.kind === "unknown"
        ? alternative
        : listValue([alternative]),
    ),
    location,
  );

/**
 * `list.slice(start, end)`: exact on a fully known list; on a partially known
 * one, known non-negative bounds inside the definite prefix select its items and
 * a `start` inside the prefix keeps the indefinite tail.
 */
const sliceList = (
  receiver: StaticListValue,
  first: StaticValue | undefined,
  second: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const indefiniteIndex = receiver.items.findIndex(isIndefiniteItem);
  const start = toIndex(first, 0);
  if (indefiniteIndex === -1) {
    const end = toIndex(second, receiver.items.length);
    return start === null || end === null
      ? unknownValue("slice with dynamic bounds", location)
      : listValue(receiver.items.slice(start, end));
  }
  const end = toIndex(second, Number.POSITIVE_INFINITY);
  if (start === null || end === null || start < 0 || end < 0 || start > indefiniteIndex)
    return receiver;
  return listValue(receiver.items.slice(start, end <= indefiniteIndex ? end : undefined));
};

export const arrayOfLength = (
  length: StaticValue,
  location: SourceLocation | null,
): StaticValue => {
  if (length.kind === "unknown-primitive" && length.primitiveType === "number")
    return listValue([
      { kind: "repeat", item: UNDEFINED_VALUE, location, count: length.numberRange },
    ]);
  if (length.kind === "branch")
    return mapValue(length, (alternative) => arrayOfLength(alternative, location));
  if (length.kind === "unknown") return unknownValue("Array() with a dynamic length", location);
  if (length.kind !== "primitive" || typeof length.value !== "number") return listValue([length]);
  if (!Number.isInteger(length.value) || length.value < 0) {
    return thrownValue(
      "Array() with an invalid length",
      createErrorValue("RangeError", [primitiveValue("Invalid array length")], location),
      location,
    );
  }
  if (length.value > MAX_ARRAY_LIKE_LENGTH)
    return listValue([{ kind: "repeat", item: UNDEFINED_VALUE, location }]);
  return listValue(Array.from({ length: length.value }, () => UNDEFINED_VALUE));
};

/** ECMAScript `ToLength`: integral, clamped to `[0, 2^53 - 1]`. */
const toLength = (value: unknown): number =>
  Math.min(Math.max(Math.trunc(Number(value)) || 0, 0), Number.MAX_SAFE_INTEGER);

/** What `Array.from(source)` copies: an iterable's items (including a native `NodeList`), else an array-like's indexed entries. */
export const iterableOrArrayLike = (
  evaluator: ArrayMethodEvaluator,
  value: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  const iterated = evaluator.resolveIterable(value, context, location);
  if (iterated !== value) return iterated;
  if (value.kind === "object") return arrayLikeToList(value);
  return value.kind === "native-object" ? null : value;
};

const arrayLikeToList = (value: Extract<StaticValue, { kind: "object" }>): StaticValue =>
  mapValue(getObjectProperty(value, "length"), (length) => {
    if (length.kind === "unknown-primitive" && length.primitiveType === "number") {
      return {
        kind: "repeat",
        item: UNDEFINED_VALUE,
        location: null,
        count: length.numberRange && {
          min: toLength(length.numberRange.min),
          max: toLength(length.numberRange.max),
        },
      };
    }
    if (length.kind !== "primitive" || typeof length.value === "symbol") {
      return unknownValue("Array.from of an array-like with dynamic length", null);
    }
    const itemCount = toLength(length.value);
    if (itemCount > MAX_ARRAY_LIKE_LENGTH)
      return { kind: "repeat", item: UNDEFINED_VALUE, location: null };
    return listValue(
      Array.from({ length: itemCount }, (_, index) => getObjectProperty(value, String(index))),
    );
  });

const CONTINUE_SEARCH = createSymbolValue("array search continues");

/**
 * `Object.groupBy` / `Map.groupBy`: every item's key must be decided for the
 * groups to be, so a dynamic key or an indefinite item list yields `unknown`.
 * Object groups are keyed by property name on a null-prototype object; Map
 * groups by key identity (SameValueZero), both in first-seen order.
 */
export const groupItems = (
  evaluator: ArrayMethodEvaluator,
  name: "Object.groupBy" | "Map.groupBy",
  iterable: StaticValue,
  callback: CallableValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const items = evaluator.resolveIterable(iterable, context, location);
  if (!hasDefiniteItems(items)) return unknownValue(`${name} of a dynamic iterable`, location);
  const isObjectGroups = name === "Object.groupBy";
  const groups = new Map<KeyIdentity, { key: StaticValue; members: StaticValue[] }>();
  for (const [index, item] of items.items.entries()) {
    const key = callCallback(evaluator, callback, [item, primitiveValue(index)], context);
    const propertyName = isObjectGroups ? getPropertyName(key) : null;
    if (isObjectGroups ? propertyName === null : !isDefiniteKey(key)) {
      return unknownValue(`${name} with a dynamic key (${describeValue(key)})`, location);
    }
    const groupKey: StaticValue = propertyName === null ? key : primitiveValue(propertyName);
    const identity = getKeyIdentity(groupKey);
    const group = groups.get(identity);
    if (group) group.members.push(item);
    else groups.set(identity, { key: groupKey, members: [item] });
  }
  const entries = [...groups.values()];
  if (isObjectGroups) {
    return {
      ...objectValue(
        entries.map(({ key, members }) => ({
          kind: "property",
          key: getPropertyName(key) ?? "",
          value: listValue(members),
        })),
      ),
      hasNullPrototype: true,
    };
  }
  return createCollectionValue(
    "Map",
    listValue(entries.map(({ key, members }) => listValue([key, listValue(members)]))),
    location,
  );
};

const MAX_FILTERED_ALTERNATIVES = 16;

/**
 * An item as `filter` keeps it: itself when accepted, null when rejected, and
 * optional when undecided. A branch item is tested per alternative so only the
 * alternatives the predicate may accept remain, and the position is preferred
 * empty when the alternative the analysis prefers was rejected.
 */
const filterItem = (
  evaluator: ArrayMethodEvaluator,
  list: StaticListValue,
  predicate: CallableValue,
  item: StaticValue,
  index: StaticValue,
  context: EvaluationContext,
): StaticValue | null => {
  const alternatives =
    item.kind === "branch" && item.alternatives.length <= MAX_FILTERED_ALTERNATIVES
      ? item.alternatives
      : [item];
  const verdicts = alternatives.map((alternative) =>
    getTruthiness(callCallback(evaluator, predicate, [alternative, index, list], context)),
  );
  if (verdicts.every((verdict) => verdict === true)) return item;
  const accepted = alternatives.filter((_, position) => verdicts[position] !== false);
  if (accepted.length === 0) return null;
  const preferredIndex = item.kind === "branch" ? item.preferredIndex : 0;
  const preferred = alternatives[preferredIndex];
  const kept =
    item.kind === "branch"
      ? branchValue(accepted, item.reason, item.location, Math.max(0, accepted.indexOf(preferred)))
      : item;
  return optionalValue(kept, "uncertain filter", null, verdicts[preferredIndex] === false);
};

const filterIndefiniteItem = (
  evaluator: ArrayMethodEvaluator,
  list: StaticListValue,
  predicate: CallableValue,
  item: StaticRepeatValue | StaticOptionalValue,
  context: EvaluationContext,
): StaticValue | null => {
  const inner = item.kind === "repeat" ? item.item : item.value;
  const verdict = getTruthiness(
    callUncertainCallback(
      evaluator,
      predicate,
      [inner, unknownPrimitiveValue("number", "index"), list],
      context,
      item.kind === "repeat",
    ),
  );
  if (verdict === false) return null;
  if (verdict === true || item.kind === "optional") return item;
  return item.count ? { ...item, count: { min: 0, max: item.count.max } } : item;
};

const filterList = (
  evaluator: ArrayMethodEvaluator,
  list: StaticListValue,
  predicate: CallableValue,
  context: EvaluationContext,
): StaticListValue => {
  const firstIndefiniteIndex = list.items.findIndex(isIndefiniteItem);
  return listValue(
    list.items.flatMap((item, index) => {
      const kept =
        item.kind === "repeat" || item.kind === "optional"
          ? filterIndefiniteItem(evaluator, list, predicate, item, context)
          : filterItem(
              evaluator,
              list,
              predicate,
              item,
              firstIndefiniteIndex === -1 || index < firstIndefiniteIndex
                ? primitiveValue(index)
                : unknownPrimitiveValue("number", "index"),
              context,
            );
      return kept ? [kept] : [];
    }),
  );
};

interface JoinedPresenceDecision {
  key: string;
  predicate: SymbolicPredicate;
  inputIds: Set<string>;
  serialized: string;
}

const MAX_JOINED_COMBINATIONS = 16;

/** `join()` over items that may be absent: one string per combination of present items. */
const joinListItems = (
  items: StaticValue[],
  separator: string,
  location: SourceLocation | null,
): StaticValue => {
  let combinationCount = 1;
  const decisions = new Map<string, JoinedPresenceDecision>();
  const predicates = new Map<string, JoinedPresenceDecision>();
  for (const item of items) {
    if (item.kind === "repeat") {
      return unknownPrimitiveValue("string", "join of a list with an unknown length");
    }
    if (item.kind !== "optional") continue;
    if (item.predicate) {
      if (predicates.has(item.predicate)) continue;
      const predicate = parseSymbolicPredicate(item.predicate);
      const key = serializeSymbolicPredicate({ ...predicate, inputs: [] });
      const existing = decisions.get(key);
      if (existing) {
        for (const input of predicate.inputs) {
          if (existing.inputIds.has(input.id)) continue;
          existing.inputIds.add(input.id);
          existing.predicate.inputs.push(input);
        }
        predicates.set(item.predicate, existing);
        continue;
      }
      const decision = {
        key,
        predicate,
        inputIds: new Set(predicate.inputs.map((input) => input.id)),
        serialized: item.predicate,
      };
      decisions.set(key, decision);
      predicates.set(item.predicate, decision);
    }
    combinationCount *= 2;
    if (combinationCount > MAX_JOINED_COMBINATIONS) {
      return unknownPrimitiveValue("string", "join of a list with many uncertain items");
    }
  }
  for (const decision of decisions.values())
    decision.serialized = serializeSymbolicPredicate(decision.predicate);
  const joinFrom = (
    startIndex: number,
    prefix: StaticValue[],
    choices: ReadonlyMap<string, boolean>,
  ): StaticValue => {
    const parts = [...prefix];
    for (let index = startIndex; index < items.length; index++) {
      const item = items[index];
      if (item.kind !== "optional") {
        parts.push(item);
        continue;
      }
      const decision = item.predicate ? predicates.get(item.predicate) : undefined;
      const presence = decision ? choices.get(decision.key) : undefined;
      if (presence !== undefined) {
        if (presence) parts.push(item.value);
        continue;
      }
      return branchValue(
        [
          joinFrom(
            index + 1,
            [...parts, item.value],
            decision ? new Map(choices).set(decision.key, true) : choices,
          ),
          joinFrom(
            index + 1,
            parts,
            decision ? new Map(choices).set(decision.key, false) : choices,
          ),
        ],
        item.reason,
        item.location ?? location,
        item.isAbsentPreferred ? 1 : 0,
        decision?.serialized ?? item.predicate,
      );
    }
    return joinStrings(parts, separator);
  };
  return joinFrom(0, [], new Map());
};

const sortListItems = (
  evaluator: ArrayMethodEvaluator,
  items: StaticValue[],
  comparator: StaticValue | undefined,
  context: EvaluationContext,
): StaticValue[] | null => {
  if (items.length < 2) return [...items];
  if (comparator === undefined) {
    const primitives: StaticPrimitive[] = [];
    for (const item of items) {
      if (item.kind !== "primitive") return null;
      primitives.push(item.value);
    }
    return primitives.sort().map(primitiveValue);
  }
  if (!isCallable(comparator)) return null;
  let isDecidable = true;
  const sorted = [...items].sort((left, right) => {
    const verdict = callCallback(evaluator, comparator, [left, right], context);
    if (verdict.kind === "primitive" && typeof verdict.value === "number") return verdict.value;
    isDecidable = false;
    return 0;
  });
  return isDecidable ? sorted : null;
};

const toGuardLiteral = (value: StaticValue): GuardLiteral | undefined =>
  value.kind === "primitive" &&
  typeof value.value !== "bigint" &&
  value.value !== undefined &&
  !Number.isNaN(value.value)
    ? value.value
    : undefined;

const isGuardLiteral = (literal: GuardLiteral | undefined): literal is GuardLiteral =>
  literal !== undefined;

/** An item of an iterable the analysis cannot enumerate: opaque, with any count. */
const getOpaqueItem = (receiver: StaticValue): StaticValue =>
  recordDerivation(unknownValue(`item of ${describeValue(receiver)}`), {
    kind: "element",
    list: receiver,
  });

interface ListMappingOptions {
  includeReceiver?: boolean;
  thisValue?: StaticValue;
}

export const mapList = (
  evaluator: ArrayMethodEvaluator,
  receiver: StaticValue,
  callback: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
  options: ListMappingOptions = {},
): StaticValue => {
  const getArguments = (item: StaticValue, index: StaticValue): StaticValue[] =>
    options.includeReceiver === false ? [item, index] : [item, index, receiver];
  const callOptions =
    options.thisValue === undefined ? undefined : { thisValue: options.thisValue };
  if (receiver.kind === "list") {
    return listValue(
      receiver.items.map((item, index) => {
        if (item.kind === "repeat") {
          return recordRepeatSource(
            {
              kind: "repeat",
              item: callUncertainCallback(
                evaluator,
                callback,
                getArguments(item.item, unknownPrimitiveValue("number", "index")),
                context,
                true,
                null,
                callOptions,
              ),
              location: item.location,
              count: item.count,
            },
            item,
          );
        }
        if (item.kind === "optional") {
          return optionalValue(
            callUncertainCallback(
              evaluator,
              callback,
              getArguments(item.value, unknownPrimitiveValue("number", "index")),
              context,
              false,
              item.predicate,
              callOptions,
            ),
            item.reason,
            item.location,
            item.isAbsentPreferred,
            item.predicate,
          );
        }
        return callCallback(
          evaluator,
          callback,
          getArguments(item, primitiveValue(index)),
          context,
          callOptions,
        );
      }),
    );
  }
  if (receiver.kind === "repeat") {
    return recordRepeatSource(
      {
        kind: "repeat",
        item: callUncertainCallback(
          evaluator,
          callback,
          getArguments(receiver.item, unknownPrimitiveValue("number", "index")),
          context,
          true,
          null,
          callOptions,
        ),
        location: receiver.location,
        count: receiver.count,
      },
      receiver,
    );
  }
  return recordRepeatSource(
    {
      kind: "repeat",
      item: callUncertainCallback(
        evaluator,
        callback,
        getArguments(getOpaqueItem(receiver), unknownPrimitiveValue("number", "index")),
        context,
        true,
        null,
        callOptions,
      ),
      location,
    },
    receiver,
  );
};

export const callArrayMethod = (
  evaluator: ArrayMethodEvaluator,
  receiver: StaticValue,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  boundArguments: StaticValue[],
): StaticValue | null => {
  const [first, second] = boundArguments;
  if (name === "map" && isCallable(first)) {
    return mapList(evaluator, receiver, first, context, location);
  }

  if (name === "forEach" && isCallable(first)) {
    if (receiver.kind === "list") {
      receiver.items.forEach((item, index) => {
        if (item.kind === "repeat" || item.kind === "optional") {
          callUncertainCallback(
            evaluator,
            first,
            [
              item.kind === "repeat" ? item.item : item.value,
              unknownPrimitiveValue("number", "index"),
              receiver,
            ],
            context,
            item.kind === "repeat",
          );
        } else callCallback(evaluator, first, [item, primitiveValue(index), receiver], context);
      });
    } else {
      callUncertainCallback(
        evaluator,
        first,
        [
          receiver.kind === "repeat" ? receiver.item : getOpaqueItem(receiver),
          unknownPrimitiveValue("number", "index"),
          receiver,
        ],
        context,
        true,
      );
    }
    return UNDEFINED_VALUE;
  }

  if (name === "flatMap" && isCallable(first)) {
    const mapped = mapList(evaluator, receiver, first, context, location);
    if (mapped.kind === "list") {
      return listValue(mapped.items.flatMap((item) => flattenOneLevel(item, location)));
    }
    return mapped;
  }

  if (receiver.kind === "list") {
    const binaryKind = getBinaryKind(receiver);
    if (name === "set" && binaryKind && binaryKind !== "ArrayBuffer")
      return callTypedSet(evaluator, receiver, args, context, location);
    const binaryResult = callBinaryMethod(receiver, name, args, location);
    if (binaryResult) return binaryResult;
    switch (name) {
      case "filter":
        return isCallable(first) ? filterList(evaluator, receiver, first, context) : receiver;
      case "slice": {
        const sliceBetween = (
          startBound: StaticValue | undefined,
          endBound: StaticValue | undefined,
        ): StaticValue => sliceList(receiver, startBound, endBound, location);
        if (first && isPrimitiveBranch(first))
          return mapValue(first, (startBound) => sliceBetween(startBound, second));
        if (second && isPrimitiveBranch(second))
          return mapValue(second, (endBound) => sliceBetween(first, endBound));
        return sliceBetween(first, second);
      }
      case "concat": {
        return listValue([
          ...receiver.items,
          ...args.flatMap((argument) => flattenOneLevel(argument, location)),
        ]);
      }
      case "reverse":
        evaluator.recordHeapMutation(receiver);
        receiver.items.reverse();
        return receiver;
      case "fill": {
        if (!isKnownList(receiver) || first === undefined) return receiver;
        if (second !== undefined || args.length > 2)
          return unknownValue("fill with a range", location);
        evaluator.recordHeapMutation(receiver);
        receiver.items.fill(first);
        return receiver;
      }
      case "toReversed":
        return listValue([...receiver.items].reverse());
      case "values":
      case ITERATOR_PROPERTY_KEY:
        return receiver;
      case "keys":
        if (!hasDefiniteItems(receiver)) break;
        return listValue(receiver.items.map((_item, index) => primitiveValue(index)));
      case "entries":
        if (!hasDefiniteItems(receiver)) break;
        return listValue(
          receiver.items.map((item, index) => listValue([primitiveValue(index), item])),
        );
      case "sort":
      case "toSorted": {
        if (!isKnownList(receiver)) return receiver;
        const sorted = sortListItems(evaluator, receiver.items, first, context);
        if (sorted === null) {
          return unknownValue(
            `${name} whose item order is not statically decidable (${first ? describeValue(first) : "default comparison"})`,
            location,
          );
        }
        if (name === "toSorted") return listValue(sorted);
        evaluator.recordHeapMutation(receiver);
        receiver.items.splice(0, receiver.items.length, ...sorted);
        return receiver;
      }
      case "flat": {
        const items: StaticValue[] = [];
        for (const item of receiver.items) {
          if (item.kind === "list") items.push(...item.items);
          else items.push(item);
        }
        return listValue(items);
      }
      case "join": {
        if (first === undefined || (first.kind === "primitive" && first.value === undefined)) {
          return joinListItems(receiver.items, ",", location);
        }
        if (first.kind !== "primitive") {
          return unknownPrimitiveValue("string", "join with a dynamic separator");
        }
        return joinListItems(receiver.items, String(first.value), location);
      }
      case "at": {
        if (first?.kind === "primitive" && isKnownList(receiver)) {
          const index = Number(first.value);
          return receiver.items.at(index) ?? UNDEFINED_VALUE;
        }
        return unknownValue("at() with dynamic index", location);
      }
      case "includes":
      case "indexOf": {
        if (!first || !hasDefiniteItems(receiver)) break;
        if (
          second !== undefined &&
          (second.kind !== "primitive" || typeof second.value !== "number")
        )
          break;
        const fromIndex =
          second?.kind === "primitive" && typeof second.value === "number"
            ? Math.max(0, second.value < 0 ? receiver.items.length + second.value : second.value)
            : 0;
        const verdicts = receiver.items
          .slice(fromIndex)
          .map((item) => compareIdentity(item, first));
        const foundIndex = verdicts.indexOf(true);
        if (
          foundIndex !== -1 &&
          verdicts.slice(0, foundIndex).every((verdict) => verdict === false)
        ) {
          return name === "includes" ? TRUE_VALUE : primitiveValue(foundIndex + fromIndex);
        }
        if (verdicts.every((verdict) => verdict === false)) {
          return name === "includes" ? FALSE_VALUE : primitiveValue(-1);
        }
        if (name === "includes" && second === undefined) {
          const literals = receiver.items.map(toGuardLiteral);
          if (literals.every(isGuardLiteral)) {
            return recordDerivation(
              unknownPrimitiveValue("boolean", `includes on ${describeValue(first)}`),
              { kind: "membership", operand: first, literals },
            );
          }
        }
        break;
      }
      case "some":
      case "every":
      case "find":
      case "findLast":
      case "findIndex":
      case "findLastIndex": {
        const isIndex = name.endsWith("Index");
        const isEvery = name === "every";
        const isQuantifier = isEvery || name === "some";
        const missing = isQuantifier
          ? primitiveValue(isEvery)
          : isIndex
            ? primitiveValue(-1)
            : UNDEFINED_VALUE;
        if (!isCallable(first) || !hasDefiniteItems(receiver)) {
          if (isIndex || isQuantifier) break;
          const candidates = receiver.items.filter((item) => item.kind !== "repeat");
          return branchValue([...candidates, missing], `${name}()`, location);
        }
        const length = receiver.items.length;
        const isReverse = name.includes("Last");
        let result: StaticValue = CONTINUE_SEARCH;
        for (let position = 0; position < length; position++) {
          const index = isReverse ? length - position - 1 : position;
          const search = (
            alternative: StaticValue,
            searchContext: EvaluationContext,
          ): StaticValue => {
            if (alternative !== CONTINUE_SEARCH) return alternative;
            const test = (testContext: EvaluationContext): StaticValue => {
              const item = evaluator.getProperty(receiver, String(index), testContext, location);
              const outcome = evaluator.callValue(
                first,
                [item, primitiveValue(index), receiver],
                testContext,
                location,
                { thisValue: second ?? UNDEFINED_VALUE },
              );
              return mapValue(outcome, (verdict) => {
                if (getThrowCertainty(verdict) === "always") return verdict;
                const found = isQuantifier
                  ? primitiveValue(!isEvery)
                  : isIndex
                    ? primitiveValue(index)
                    : item;
                const whenTrue = isEvery ? CONTINUE_SEARCH : found;
                const whenFalse = isEvery ? found : CONTINUE_SEARCH;
                const truthiness = getTruthiness(verdict);
                return truthiness === null
                  ? branchValue(
                      [whenTrue, whenFalse],
                      `${name}()`,
                      location,
                      getPreferredTruthiness(verdict) === false ? 1 : 0,
                      getTruthinessPredicate(verdict),
                    )
                  : truthiness
                    ? whenTrue
                    : whenFalse;
              });
            };
            const presence = isQuantifier
              ? (hasProperty(primitiveValue(index), receiver) ??
                branchValue(
                  [TRUE_VALUE, FALSE_VALUE],
                  `${name}(): array index presence is not known`,
                  location,
                ))
              : TRUE_VALUE;
            return presence.kind === "branch"
              ? evaluator.callAlternatives(presence, searchContext, (present, presentContext) =>
                  getTruthiness(present) === false ? CONTINUE_SEARCH : test(presentContext),
                )
              : getTruthiness(presence) === false
                ? CONTINUE_SEARCH
                : test(searchContext);
          };
          result =
            result.kind === "branch"
              ? evaluator.callAlternatives(result, context, search)
              : search(result, context);
          if (
            result !== CONTINUE_SEARCH &&
            (result.kind !== "branch" || !result.alternatives.includes(CONTINUE_SEARCH))
          )
            break;
        }
        return mapValue(result, (alternative) =>
          alternative === CONTINUE_SEARCH ? missing : alternative,
        );
      }
      case "reduce":
      case "reduceRight": {
        if (!isCallable(first) || receiver.kind !== "list") {
          return unknownValue(`${name}()`, location);
        }
        const items = name === "reduce" ? receiver.items : [...receiver.items].reverse();
        let accumulator = args.length > 1 ? second : items[0];
        if (!accumulator) return unknownValue(`${name}() of an empty list`, location);
        if (accumulator.kind === "optional" || accumulator.kind === "repeat") {
          return unknownValue(`${name}() of a list whose first item may be absent`, location);
        }
        const startIndex = args.length > 1 ? 0 : 1;
        let isIndexKnown = true;
        for (let index = startIndex; index < items.length; index++) {
          const item = items[index];
          const sourceIndex = name === "reduce" ? index : items.length - 1 - index;
          const indexValue = isIndexKnown
            ? primitiveValue(sourceIndex)
            : unknownPrimitiveValue("number", "index");
          if (item.kind !== "optional" && item.kind !== "repeat") {
            accumulator = callCallback(
              evaluator,
              first,
              [accumulator, item, indexValue, receiver],
              context,
            );
            continue;
          }
          isIndexKnown = false;
          const reduced = callUncertainCallback(
            evaluator,
            first,
            [accumulator, getItemValue(item), indexValue, receiver],
            context,
            item.kind === "repeat",
          );
          if (item.kind === "repeat") {
            if (reduced !== accumulator) {
              accumulator = widenLoopCarriedValue(
                branchValue([reduced, accumulator], "repeated items", location),
                location,
              );
            }
            continue;
          }
          accumulator = branchValue(
            [reduced, accumulator],
            item.reason,
            item.location,
            item.isAbsentPreferred ? 1 : 0,
          );
          if (countAlternatives(accumulator) > MAX_DISTRIBUTED_ALTERNATIVES) {
            return unknownValue(`${name}() over many items that may be absent`, location);
          }
        }
        return accumulator;
      }
      case "push":
      case "unshift": {
        // Inside an uncertain path (e.g. a loop of unknown length) the pushed
        // items may occur any number of times, so they become a repeat.
        const pushed: StaticValue[] =
          context.uncertainDepth > 0
            ? [{ kind: "repeat", item: args.length === 1 ? args[0] : listValue(args), location }]
            : args;
        evaluator.recordHeapMutation(receiver);
        if (name === "push") receiver.items.push(...pushed);
        else receiver.items.unshift(...pushed);
        return getListLength(receiver);
      }
      case "pop":
      case "shift": {
        const remove = (items: StaticValue[]): StaticValue => {
          evaluator.recordHeapMutation(receiver);
          receiver.items = items;
          return (name === "pop" ? items.pop() : items.shift()) ?? UNDEFINED_VALUE;
        };
        if (context.uncertainDepth === 0) {
          const items = receiver.items;
          if (hasDefiniteItems(receiver)) return remove(items);
          const shapes = mapFiniteListItems(items, listValue);
          if (shapes) {
            const removeAlternative = (alternative: StaticValue): StaticValue =>
              alternative.kind === "list"
                ? remove([...alternative.items])
                : unknownValue(`${name}() of an uncertain list`, location);
            return shapes.kind === "branch"
              ? evaluator.callAlternatives(shapes, context, removeAlternative)
              : removeAlternative(shapes);
          }
        }
        evaluator.recordHeapMutation(receiver);
        receiver.items = receiver.items.map((item) =>
          isIndefiniteItem(item) ? item : optionalValue(item, `uncertain ${name}()`, location),
        );
        return unknownValue(`${name}() of an uncertain list`, location);
      }
      case "splice": {
        evaluator.recordHeapMutation(receiver);
        const start = first?.kind === "primitive" ? Number(first.value) : Number.NaN;
        const deleteCount =
          second === undefined
            ? receiver.items.length
            : second.kind === "primitive"
              ? Number(second.value)
              : Number.NaN;
        if (
          hasDefiniteItems(receiver) &&
          context.uncertainDepth === 0 &&
          Number.isInteger(start) &&
          Number.isInteger(deleteCount)
        ) {
          return listValue(receiver.items.splice(start, deleteCount, ...args.slice(2)));
        }
        receiver.items = [
          ...receiver.items.map((item) =>
            isIndefiniteItem(item) ? item : optionalValue(item, "uncertain splice()", location),
          ),
          ...args
            .slice(2)
            .map((inserted): StaticValue => ({ kind: "repeat", item: inserted, location })),
        ];
        return unknownValue("splice() of an uncertain list", location);
      }
      default:
        break;
    }
  }

  return null;
};

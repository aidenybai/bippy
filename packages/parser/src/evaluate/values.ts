import type { HostDocument } from "../host/host-document.js";
import { GLOBAL_INTERFACE_NAME } from "../host/realm-table.js";
import type { Class } from "oxc-parser";
import type {
  FunctionLikeNode,
  JsonValue,
  NumberRange,
  Scope,
  SourceLocation,
  StaticAccessor,
  StaticBranchValue,
  StaticClassValue,
  StaticElementType,
  StaticFunctionValue,
  StaticListValue,
  StaticNativeObjectValue,
  StaticObjectEntry,
  StaticPropertyEntry,
  StaticObjectValue,
  StaticOptionalValue,
  StaticPrimitive,
  StaticPrimitiveValue,
  StaticRegExpValue,
  StaticSymbolValue,
  StaticUnknownPrimitiveValue,
  StaticUnknownValue,
  StaticValue,
  StringComposition,
  StubComponent,
  UnknownPrimitiveType,
} from "../types.js";
import { getExternalMember, getReactApiTypeof } from "../react/react-api.js";
import { recordBranchOrigin, recordDerivation } from "./predicates.js";

export const isKnownString = (
  value: StaticValue,
): value is StaticPrimitiveValue & { value: string } =>
  value.kind === "primitive" && typeof value.value === "string";

export const UNDEFINED_VALUE: StaticPrimitiveValue = { kind: "primitive", value: undefined };
export const NULL_VALUE: StaticPrimitiveValue = { kind: "primitive", value: null };
export const TRUE_VALUE: StaticPrimitiveValue = { kind: "primitive", value: true };
export const FALSE_VALUE: StaticPrimitiveValue = { kind: "primitive", value: false };

export const primitiveValue = (value: StaticPrimitive): StaticPrimitiveValue => ({
  kind: "primitive",
  value,
});

export const booleanValue = (value: boolean): StaticPrimitiveValue =>
  value ? TRUE_VALUE : FALSE_VALUE;

export const isUndefinedValue = (value: StaticValue | undefined): boolean =>
  value === undefined || (value.kind === "primitive" && value.value === undefined);

export const isFunctionValue = (
  value: StaticValue | undefined,
): value is Extract<StaticValue, { kind: "function" | "native-function" }> =>
  value?.kind === "function" || value?.kind === "native-function";

export const unknownValue = (
  reason: string,
  location: SourceLocation | null = null,
): StaticUnknownValue => ({
  kind: "unknown",
  reason,
  location,
});

/**
 * A nullish `?.` receiver skips every remaining link of its chain, so the
 * links after it pass this marker through; the enclosing `ChainExpression`
 * turns it into `undefined`.
 */
export const CHAIN_SHORT_CIRCUIT: StaticUnknownValue = unknownValue("optional chain short-circuit");

export const completeChain = (value: StaticValue): StaticValue =>
  mapValue(value, (alternative) =>
    alternative === CHAIN_SHORT_CIRCUIT ? UNDEFINED_VALUE : alternative,
  );

/** The outcome of a path that throws `thrown`; `reason` names the throw for reports. */
export const thrownValue = (
  reason: string,
  thrown: StaticValue,
  location: SourceLocation | null = null,
): StaticUnknownValue => ({ ...unknownValue(reason, location), thrown });

export const unknownPrimitiveValue = (
  primitiveType: UnknownPrimitiveType,
  reason: string,
): StaticUnknownPrimitiveValue => ({ kind: "unknown-primitive", primitiveType, reason });

let allocationCount = 0;

/** Ordinal of the most recent heap allocation; later allocations get larger ordinals. */
export const getAllocationCount = (): number => allocationCount;

export const allocate = (): number => ++allocationCount;

/** A newly allocated array: `===` to no other value analysis constructs. */
export const listValue = (items: StaticValue[]): StaticListValue => ({
  kind: "list",
  items,
  allocation: allocate(),
});

/** `Class.__proto__` / `Object.getPrototypeOf(Class)`: the parent class, or `Function.prototype` for a base class. */
export const getClassPrototype = (classValue: StaticClassValue): StaticValue =>
  classValue.body.superValue ?? { kind: "global", name: "Function.prototype" };

/** A newly allocated object: `===` to no other value analysis constructs. */
export const objectValue = (entries: StaticObjectEntry[] = []): StaticObjectValue => ({
  kind: "object",
  entries,
  allocation: allocate(),
});

export const objectFromRecord = (record: Record<string, StaticValue>): StaticObjectValue =>
  objectValue(Object.entries(record).map(([key, value]) => ({ kind: "property", key, value })));

export const isJsonRecord = (json: JsonValue): json is { [key: string]: JsonValue } =>
  json !== null && typeof json === "object" && !Array.isArray(json);

/** A value known whole, as a bundler inlines a `define` replacement. */
export const jsonValue = (json: JsonValue): StaticValue => {
  if (json === null || typeof json !== "object") return primitiveValue(json);
  if (Array.isArray(json)) return listValue(json.map(jsonValue));
  return objectValue(
    Object.entries(json).map(([key, item]): StaticObjectEntry => ({
      kind: "property",
      key,
      value: jsonValue(item),
    })),
  );
};

/**
 * A value the served page defines (e.g. on `window`). Only the configured keys
 * are known; objects stay open so reads of other keys are unknown rather than
 * `undefined`.
 */
export const partialJsonValue = (json: JsonValue, name: string): StaticValue => {
  if (json === null || typeof json !== "object") return primitiveValue(json);
  if (Array.isArray(json)) {
    return listValue(json.map((item, index) => partialJsonValue(item, `${name}[${index}]`)));
  }
  return objectValue([
    { kind: "spread", value: unknownValue(`${name} beyond the configured keys`) },
    ...Object.entries(json).map(([key, item]): StaticObjectEntry => ({
      kind: "property",
      key,
      value: partialJsonValue(item, `${name}.${key}`),
    })),
  ]);
};

/** One interpreter value per native object, so identity comparisons and collection keys hold. */
const nativeObjectValues = new WeakMap<object, StaticNativeObjectValue>();

export const nativeObjectValue = (
  value: object,
  host: HostDocument | null,
): StaticNativeObjectValue => {
  let lifted = nativeObjectValues.get(value);
  if (!lifted) {
    lifted = { kind: "native-object", value, host };
    nativeObjectValues.set(value, lifted);
  }
  return lifted;
};

/**
 * What `JSON.stringify` would produce for a value every part of which is known;
 * `undefined` when some part is not (or when the value itself serializes to nothing).
 */
export const toJsonValue = (value: StaticValue): JsonValue | undefined => {
  switch (value.kind) {
    case "primitive":
      if (typeof value.value === "number") {
        return Number.isFinite(value.value) ? value.value : null;
      }
      return value.value === undefined || typeof value.value === "bigint" ? undefined : value.value;
    case "list": {
      if (!hasDefiniteItems(value)) return undefined;
      const items: JsonValue[] = [];
      for (const item of value.items) {
        if (item.kind === "primitive" && item.value === undefined) {
          items.push(null);
          continue;
        }
        const json = toJsonValue(item);
        if (json === undefined) return undefined;
        items.push(json);
      }
      return items;
    }
    case "object": {
      const keys = getKnownObjectKeys(value);
      if (keys === null) return undefined;
      const record: Record<string, JsonValue> = {};
      for (const key of keys) {
        const property = getObjectProperty(value, key);
        if (property.kind === "primitive" && property.value === undefined) continue;
        const json = toJsonValue(property);
        if (json === undefined) return undefined;
        record[key] = json;
      }
      return record;
    }
    default:
      return undefined;
  }
};

/** Overwrites the own property `key` when nothing spread after it could shadow the write. */
export const setObjectProperty = (
  object: StaticObjectValue,
  key: string,
  value: StaticValue,
): void => {
  for (let index = object.entries.length - 1; index >= 0; index--) {
    const entry = object.entries[index];
    if (entry.kind === "spread") break;
    if (entry.key === key) {
      object.entries[index] = { kind: "property", key, value };
      return;
    }
  }
  object.entries.push({ kind: "property", key, value });
};

/** The accessor owning `key`, unless a later spread could shadow it. */
export const getObjectAccessor = (
  object: StaticObjectValue,
  key: string,
): StaticAccessor | null => {
  for (let index = object.entries.length - 1; index >= 0; index--) {
    const entry = object.entries[index];
    if (entry.kind === "spread") return null;
    if (entry.key === key) return entry.accessor ?? null;
  }
  return object.prototype ? getObjectAccessor(object.prototype, key) : null;
};

export const accessorEntry = (
  key: string,
  accessor: StaticAccessor,
  location: SourceLocation | null,
): StaticPropertyEntry => ({
  kind: "property",
  key,
  value: unknownValue(`accessor property "${key}"`, location),
  accessor,
});

type LookupMemo = Map<StaticObjectValue, Map<number, Map<string, StaticValue>>>;

/**
 * Results of the lookup in progress. Objects spread through many branches
 * (`state = cond ? {...state, ...next} : state` repeated) are reached once per
 * path otherwise, and nothing mutates while a lookup runs.
 */
let lookupMemo: LookupMemo | null = null;

export const getObjectProperty = (object: StaticObjectValue, key: string): StaticValue => {
  if (lookupMemo) return getMemoizedObjectProperty(lookupMemo, object, key, object.entries.length);
  lookupMemo = new Map();
  try {
    return getMemoizedObjectProperty(lookupMemo, object, key, object.entries.length);
  } finally {
    lookupMemo = null;
  }
};

/** `key` as seen through the first `entryCount` entries of `object` (and its prototype). */
const getMemoizedObjectProperty = (
  memo: LookupMemo,
  object: StaticObjectValue,
  key: string,
  entryCount: number,
): StaticValue => {
  let prefixes = memo.get(object);
  let properties = prefixes?.get(entryCount);
  const memoized = properties?.get(key);
  if (memoized) return memoized;
  const value = lookupObjectProperty(memo, object, key, entryCount);
  if (!prefixes) {
    prefixes = new Map();
    memo.set(object, prefixes);
  }
  if (!properties) {
    properties = new Map();
    prefixes.set(entryCount, properties);
  }
  properties.set(key, value);
  return value;
};

const isPresent = (value: StaticValue): boolean =>
  value.kind !== "primitive" || value.value !== undefined;

const lookupObjectProperty = (
  memo: LookupMemo,
  object: StaticObjectValue,
  key: string,
  entryCount: number,
): StaticValue => {
  for (let index = entryCount - 1; index >= 0; index--) {
    const entry = object.entries[index];
    if (entry.kind === "property") {
      if (entry.key === key) return entry.value;
      continue;
    }
    const spread = entry.value;
    if (spread.kind === "branch") {
      let fromEarlier: StaticValue | null = null;
      return branchValue(
        spread.alternatives.map((alternative) => {
          const own =
            getSpreadProperty(memo, alternative, key) ?? unknownSpreadProperty(alternative, key);
          if (isPresent(own)) return own;
          fromEarlier ??= getMemoizedObjectProperty(memo, object, key, index);
          return fromEarlier;
        }),
        spread.reason,
        spread.location,
        spread.preferredIndex,
        spread.predicate,
      );
    }
    const own = getSpreadProperty(memo, spread, key);
    if (own === null) {
      const fromSpread = unknownSpreadProperty(spread, key);
      const fromEarlier = getMemoizedObjectProperty(memo, object, key, index);
      return isPresent(fromEarlier)
        ? branchValue([fromEarlier, fromSpread], fromSpread.reason, null)
        : fromSpread;
    }
    if (isPresent(own)) return own;
  }
  return getInheritedProperty(memo, object, key);
};

const unknownSpreadProperty = (spread: StaticValue, key: string): StaticUnknownValue =>
  unknownValue(`property "${key}" may come from a spread of ${describeValue(spread)}`);

const getInheritedProperty = (
  memo: LookupMemo,
  object: StaticObjectValue,
  key: string,
): StaticValue => {
  if (key === "constructor" && object.constructedBy) return object.constructedBy;
  if (object.prototype)
    return getMemoizedObjectProperty(memo, object.prototype, key, object.prototype.entries.length);
  return key === "constructor" && !object.hasNullPrototype
    ? { kind: "global", name: "Object" }
    : UNDEFINED_VALUE;
};

/** What `{...spread}[key]` contributes, or `null` for a spread whose keys are unknowable. */
const getSpreadProperty = (
  memo: LookupMemo,
  spread: StaticValue,
  key: string,
): StaticValue | null => {
  switch (spread.kind) {
    case "object":
      return getMemoizedObjectProperty(memo, spread, key, spread.entries.length);
    case "primitive":
    case "function":
    case "class":
      return UNDEFINED_VALUE;
    case "external":
      if (spread.importedName === "*" && spread.origin === "binding") {
        return getExternalMember(spread, key);
      }
      return null;
    case "branch":
      return branchValue(
        spread.alternatives.map(
          (alternative) =>
            getSpreadProperty(memo, alternative, key) ?? unknownSpreadProperty(alternative, key),
        ),
        spread.reason,
        spread.location,
        spread.preferredIndex,
        spread.predicate,
      );
    default:
      return null;
  }
};

/** `fn.prototype` of a constructor function, created on first access like engines do. */
export const getFunctionPrototype = (fn: StaticFunctionValue): StaticValue => {
  if (fn.node.type === "ArrowFunctionExpression") return UNDEFINED_VALUE;
  const existing = fn.properties.get("prototype");
  if (existing) return existing;
  const prototype = objectFromRecord({ constructor: fn });
  fn.properties.set("prototype", prototype);
  return prototype;
};

const unregisteredSymbols = new Map<string, StaticSymbolValue>();

/** `Symbol(description)`: identical only to itself, unlike `Symbol.for` registry symbols. */
export const createSymbolValue = (description: string | undefined): StaticSymbolValue => {
  const symbol: StaticSymbolValue = { kind: "symbol", key: `#${allocate()}` };
  if (description !== undefined) symbol.description = description;
  unregisteredSymbols.set(symbol.key, symbol);
  return symbol;
};

export const getSymbolDescription = (symbol: StaticSymbolValue): string | undefined =>
  unregisteredSymbols.has(symbol.key) ? symbol.description : symbol.key;

/** Symbol-keyed properties are stored under an `@@` key; enumeration skips them like `Object.keys` does. */
export const SYMBOL_PROPERTY_KEY_PREFIX = "@@";

export const getSymbolPropertyKey = (symbol: StaticSymbolValue): string =>
  `${SYMBOL_PROPERTY_KEY_PREFIX}${symbol.key}`;

export const isSymbolPropertyKey = (key: string): boolean =>
  key.startsWith(SYMBOL_PROPERTY_KEY_PREFIX);

export const ITERATOR_PROPERTY_KEY = `${SYMBOL_PROPERTY_KEY_PREFIX}Symbol.iterator`;

/** The property name a computed key denotes, or `null` when the key is not statically known. */
export const getPropertyName = (key: StaticValue): string | null => {
  if (key.kind === "primitive") return String(key.value);
  return key.kind === "symbol" ? getSymbolPropertyKey(key) : null;
};

/** Own keys in definition order mapped to their enumerability (the last definition of a key decides); null when a spread source is not fully known. */
const getKnownOwnKeys = (
  object: StaticObjectValue,
  isIncluded: (key: string) => boolean,
): Map<string, boolean> | null => {
  const keys = new Map<string, boolean>();
  for (const entry of object.entries) {
    if (entry.kind === "property") {
      if (isIncluded(entry.key)) keys.set(entry.key, entry.isEnumerable !== false);
      continue;
    }
    const spreadKeys = getKnownSpreadKeys(entry.value);
    if (!spreadKeys) return null;
    for (const key of spreadKeys) if (isIncluded(key)) keys.set(key, true);
  }
  return keys;
};

const getEnumerableKeys = (keys: Map<string, boolean> | null): string[] | null =>
  keys && [...keys].filter(([, isEnumerable]) => isEnumerable).map(([key]) => key);

/** Own enumerable string keys in `Object.keys` order; null when the shape is not fully known. */
export const getKnownObjectKeys = (object: StaticObjectValue): string[] | null =>
  getEnumerableKeys(getKnownOwnKeys(object, (key) => !isSymbolPropertyKey(key)));

/** Own string keys including non-enumerable ones, as `Object.getOwnPropertyNames` lists them. */
export const getKnownObjectOwnNames = (object: StaticObjectValue): string[] | null => {
  const keys = getKnownOwnKeys(object, (key) => !isSymbolPropertyKey(key));
  return keys && [...keys.keys()];
};

const spreadHasOwnKey = (spread: StaticValue, key: string): boolean | null => {
  switch (spread.kind) {
    case "object":
      return hasOwnKey(spread, key);
    case "primitive":
      return false;
    case "branch": {
      const verdicts = spread.alternatives.map((alternative) => spreadHasOwnKey(alternative, key));
      if (verdicts.every((verdict) => verdict === true)) return true;
      return verdicts.every((verdict) => verdict === false) ? false : null;
    }
    default:
      return null;
  }
};

/** Whether `key` is an own property; null when a spread may or may not carry it. */
export const hasOwnKey = (object: StaticObjectValue, key: string): boolean | null => {
  let verdict: boolean | null = false;
  for (const entry of object.entries) {
    const entryVerdict =
      entry.kind === "property" ? entry.key === key : spreadHasOwnKey(entry.value, key);
    if (entryVerdict === true) return true;
    if (entryVerdict === null) verdict = null;
  }
  return verdict;
};

/** `Object.getOwnPropertyDescriptor(object, key)`, or null when a dynamic spread could own `key`. */
export const getOwnPropertyDescriptor = (
  object: StaticObjectValue,
  key: string,
): StaticValue | null => {
  const ownKeys = getKnownOwnKeys(object, () => true);
  if (!ownKeys) return null;
  const isEnumerable = ownKeys.get(key);
  if (isEnumerable === undefined) return UNDEFINED_VALUE;
  const isConfigurable = primitiveValue(object.isFrozen !== true);
  const accessor = getObjectAccessor(object, key);
  if (accessor) {
    return objectFromRecord({
      get: accessor.get ?? UNDEFINED_VALUE,
      set: accessor.set ?? UNDEFINED_VALUE,
      enumerable: primitiveValue(isEnumerable),
      configurable: isConfigurable,
    });
  }
  return objectFromRecord({
    value: getObjectProperty(object, key),
    writable: isConfigurable,
    enumerable: primitiveValue(isEnumerable),
    configurable: isConfigurable,
  });
};

/** The symbols keying own properties, as `Object.getOwnPropertySymbols` lists them. */
export const getKnownObjectSymbols = (object: StaticObjectValue): StaticSymbolValue[] | null => {
  const keys = getKnownOwnKeys(object, isSymbolPropertyKey);
  return keys
    ? [...keys.keys()].map((propertyKey) => {
        const key = propertyKey.slice(SYMBOL_PROPERTY_KEY_PREFIX.length);
        return unregisteredSymbols.get(key) ?? { kind: "symbol", key };
      })
    : null;
};

/** Own enumerable string and symbol keys, as `Object.keys` followed by the enumerable `Object.getOwnPropertySymbols`; null when the shape is not fully known. */
export const getKnownEnumerableOwnKeys = (object: StaticObjectValue): string[] | null =>
  getEnumerableKeys(getKnownOwnKeys(object, () => true));

/** Keys `{ ...spread }` copies: the source's own enumerable string and symbol keys. */
const getKnownSpreadKeys = (spread: StaticValue): string[] | null => {
  switch (spread.kind) {
    case "object":
      return getKnownEnumerableOwnKeys(spread);
    case "primitive":
      return [];
    case "branch": {
      const keys: string[] = [];
      for (const alternative of spread.alternatives) {
        const alternativeKeys = getKnownSpreadKeys(alternative);
        if (!alternativeKeys) return null;
        for (const key of alternativeKeys) if (!keys.includes(key)) keys.push(key);
      }
      return keys;
    }
    default:
      return null;
  }
};

/**
 * Copies a closed spread source into one property per key, so `{ ...source }`
 * snapshots the source instead of aliasing its later mutations and a branch
 * source becomes per-key branches rather than a nested spread whose depth
 * every following `{ ...state, key }` would double.
 */
export const getSpreadEntries = (spread: StaticValue): StaticObjectEntry[] | null => {
  if (spread.kind !== "object" && spread.kind !== "branch") return null;
  const keys = getKnownSpreadKeys(spread);
  if (!keys) return null;
  const holder = objectValue([{ kind: "spread", value: spread }]);
  return keys.map((key) => ({ kind: "property", key, value: getObjectProperty(holder, key) }));
};

/**
 * Joins the entry lists paths left on one object. Paths that only assigned
 * properties join per key (a path that skipped a key keeps the entry value);
 * anything else keeps whole alternatives behind one spread.
 */
export const joinObjectEntries = (
  original: StaticObjectEntry[],
  pathEntries: StaticObjectEntry[][],
  reason: string,
  location: SourceLocation | null,
  preferredIndex: number,
  predicate: string | null,
): StaticObjectEntry[] => {
  const pathObjects = pathEntries.map((entries) => objectValue(entries));
  const joinedKeys = getJoinedPropertyKeys(original, pathEntries);
  if (joinedKeys === null) {
    return [
      ...original,
      {
        kind: "spread",
        value: branchValue(pathObjects, reason, location, preferredIndex, predicate),
      },
    ];
  }
  const joinedEntry = (key: string): StaticObjectEntry => ({
    kind: "property",
    key,
    value: branchValue(
      pathObjects.map((pathObject) => getObjectProperty(pathObject, key)),
      reason,
      location,
      preferredIndex,
      predicate,
    ),
  });
  const lastSpreadIndex = original.findLastIndex((entry) => entry.kind === "spread");
  const placedKeys = new Set<string>();
  const entries = original.map((entry, index) => {
    if (entry.kind === "spread" || index < lastSpreadIndex || !joinedKeys.has(entry.key)) {
      return entry;
    }
    placedKeys.add(entry.key);
    return joinedEntry(entry.key);
  });
  for (const key of joinedKeys) if (!placedKeys.has(key)) entries.push(joinedEntry(key));
  return entries;
};

/**
 * The keys whose own property entries some path replaced, added or removed, or
 * null when a path also changed the spreads or an accessor: only property-level
 * differences can be joined per key without nesting the alternatives.
 */
const getJoinedPropertyKeys = (
  original: StaticObjectEntry[],
  pathEntries: StaticObjectEntry[][],
): Set<string> | null => {
  const originalSpreads = original.filter((entry) => entry.kind === "spread");
  const originalEntries = new Set(original);
  const keys = new Set<string>();
  for (const entries of pathEntries) {
    const pathEntrySet = new Set(entries);
    let spreadIndex = 0;
    for (const entry of entries) {
      if (entry.kind === "spread") {
        if (originalSpreads[spreadIndex++] !== entry) return null;
        continue;
      }
      if (originalEntries.has(entry)) continue;
      if (entry.accessor) return null;
      keys.add(entry.key);
    }
    if (spreadIndex !== originalSpreads.length) return null;
    for (const entry of original) {
      if (entry.kind === "spread" || pathEntrySet.has(entry)) continue;
      if (entry.accessor) return null;
      keys.add(entry.key);
    }
  }
  return keys;
};

/**
 * `object` without `omitted` keys. Objects that never held one of the keys are
 * returned as they are, so a spread chain shared through many joins stays shared.
 */
export const omitObjectKeys = (object: StaticObjectValue, omitted: Set<string>): StaticValue => {
  const rest = omitObjectKeysShared(object, omitted, new Map());
  return rest === object ? objectValue([...object.entries]) : rest;
};

/**
 * The rest of destructuring `source`: its own enumerable keys minus `omitted`.
 * A primitive has none but a string's indices, so its rest is a fresh object.
 */
export const omitRestKeys = (source: StaticValue, omitted: Set<string>): StaticValue => {
  if (source.kind === "object") return omitObjectKeys(source, omitted);
  if (source.kind !== "primitive" || source.value === null || source.value === undefined) {
    return unknownValue(`rest of ${describeValue(source)}`);
  }
  return typeof source.value === "string"
    ? objectValue(
        [...source.value].flatMap((character, index) =>
          omitted.has(String(index))
            ? []
            : [{ kind: "property", key: String(index), value: primitiveValue(character) }],
        ),
      )
    : objectValue();
};

const omitObjectKeysShared = (
  object: StaticObjectValue,
  omitted: Set<string>,
  results: Map<StaticObjectValue, StaticValue>,
): StaticValue => {
  const memoized = results.get(object);
  if (memoized) return memoized;
  const entries: StaticObjectEntry[] = [];
  let isChanged = false;
  for (const entry of object.entries) {
    if (entry.kind === "property") {
      if (omitted.has(entry.key)) isChanged = true;
      else entries.push(entry);
      continue;
    }
    const rest = omitSpreadKeys(entry.value, omitted, results);
    if (rest === entry.value) {
      entries.push(entry);
      continue;
    }
    if (rest.kind !== "object" && rest.kind !== "branch" && rest.kind !== "primitive") {
      results.set(object, rest);
      return rest;
    }
    isChanged = true;
    entries.push({ kind: "spread", value: rest });
  }
  const result = isChanged ? objectValue(entries) : object;
  results.set(object, result);
  return result;
};

const omitSpreadKeys = (
  spread: StaticValue,
  omitted: Set<string>,
  results: Map<StaticObjectValue, StaticValue>,
): StaticValue => {
  switch (spread.kind) {
    case "object":
      return omitObjectKeysShared(spread, omitted, results);
    case "primitive":
    case "unknown":
      return spread;
    case "branch": {
      const alternatives = spread.alternatives.map((alternative) =>
        omitSpreadKeys(alternative, omitted, results),
      );
      if (alternatives.every((alternative, index) => alternative === spread.alternatives[index])) {
        return spread;
      }
      return branchValue(
        alternatives,
        spread.reason,
        spread.location,
        spread.preferredIndex,
        spread.predicate,
      );
    }
    default:
      return unknownValue(`rest of ${describeValue(spread)}`);
  }
};

/** `delete object[key]`: an own property vanishes; one a dynamic spread may hold stays as uncertain as that spread. */
export const deleteObjectProperty = (object: StaticObjectValue, key: string): void => {
  const remaining = omitObjectKeysShared(object, new Set([key]), new Map());
  if (remaining === object) return;
  object.entries.splice(
    0,
    object.entries.length,
    ...(remaining.kind === "object"
      ? remaining.entries
      : object.entries.filter((entry) => entry.kind === "spread" || entry.key !== key)),
  );
};

/** Whether the object's latest entry already makes every property uncertain, as a `delete` of a dynamic key does. */
export const hasTrailingUnknownSpread = (object: StaticObjectValue): boolean => {
  const last = object.entries.at(-1);
  return last?.kind === "spread" && last.value.kind === "unknown";
};

export const componentReference = (type: StaticElementType): StaticValue => ({
  kind: "component-reference",
  type,
});

/** `===` between two values analysis knows completely: the same allocation, primitive, or external binding. */
export const isSameValue = (left: StaticValue, right: StaticValue): boolean => {
  if (left === right) return true;
  if (left.kind === "primitive" && right.kind === "primitive") {
    return Object.is(left.value, right.value);
  }
  if (left.kind === "global" && right.kind === "global") return left.name === right.name;
  if (left.kind === "symbol" && right.kind === "symbol") return left.key === right.key;
  if (left.kind === "react-api" && right.kind === "react-api") return left.api === right.api;
  return (
    left.kind === "external" &&
    right.kind === "external" &&
    left.origin === "binding" &&
    right.origin === "binding" &&
    left.packageName === right.packageName &&
    left.importedName === right.importedName &&
    left.specifier === right.specifier
  );
};

const CALLABLE_KINDS = new Set<StaticValue["kind"]>([
  "function",
  "class",
  "native-function",
  "method",
]);

/** Each models one runtime class of object (array, RegExp, module namespace...), so values of two kinds are never the same object. */
const NON_CALLABLE_OBJECT_KINDS = new Set<StaticValue["kind"]>([
  "element",
  "list",
  "object",
  "regexp",
  "context",
  "native-object",
  "namespace",
]);

/** Reference values whose `typeof` (`function` or `object`) the model does not fix. */
const REFERENCE_KINDS = new Set<StaticValue["kind"]>(["proxy", "react-api", "component-reference"]);

type IdentityClass = "scalar" | "symbol" | "callable" | "object" | "reference";

const isReferenceClass = (identityClass: IdentityClass): boolean =>
  identityClass === "callable" || identityClass === "object" || identityClass === "reference";

/** Whether two values of these classes may be the same value. */
const canShareIdentityClass = (left: IdentityClass, right: IdentityClass): boolean =>
  left === right ||
  (left === "reference" && isReferenceClass(right)) ||
  (right === "reference" && isReferenceClass(left));

const SYMBOL_ELEMENT_KINDS = new Set<StaticElementType["kind"]>([
  "fragment",
  "strict-mode",
  "profiler",
  "suspense",
  "suspense-list",
  "activity",
  "view-transition",
]);

/** The runtime `typeof` a value is known to have, when identity can be decided from it. */
const getIdentityClass = (value: StaticValue): IdentityClass | null => {
  switch (value.kind) {
    case "primitive":
      return "scalar";
    case "unknown-primitive":
      return value.primitiveType === "any" ? null : "scalar";
    case "symbol":
      return "symbol";
    case "react-api":
      return getReactApiTypeof(value.api) === "symbol" ? "symbol" : "reference";
    case "component-reference":
      if (SYMBOL_ELEMENT_KINDS.has(value.type.kind)) return "symbol";
      if (value.type.kind === "host") return "scalar";
      return value.type.kind === "external" || value.type.kind === "unknown" ? null : "reference";
    default:
      if (CALLABLE_KINDS.has(value.kind)) return "callable";
      if (NON_CALLABLE_OBJECT_KINDS.has(value.kind)) return "object";
      return REFERENCE_KINDS.has(value.kind) ? "reference" : null;
  }
};

/** The `typeof` of a scalar, when known: a typed unknown primitive can never equal a scalar of another type. */
const getScalarTypeof = (value: StaticValue): string | null => {
  if (value.kind === "primitive") return typeof value.value;
  if (value.kind === "unknown-primitive") return value.primitiveType;
  return null;
};

const isHeapValue = (value: StaticValue): value is StaticObjectValue | StaticListValue =>
  value.kind === "object" || value.kind === "list";

const isCallableValue = (value: StaticValue): value is StaticFunctionValue | StaticClassValue =>
  value.kind === "function" || value.kind === "class";

interface ClosureIdentity {
  node: FunctionLikeNode | Class;
  scope: Scope;
}

/** The closure or class a callable or an element's `type` refers to; a bound function is a distinct object. */
const getClosureIdentity = (value: StaticValue): ClosureIdentity | null => {
  if (value.kind === "class") return value;
  if (value.kind === "function") return value.boundArgs || value.boundThis ? null : value;
  if (value.kind !== "component-reference") return null;
  const { type } = value;
  return type.kind === "function" || type.kind === "class" ? type.component : null;
};

/** A `forwardRef`/`memo`/`lazy` object, never identical to a closure or class. */
const isWrapperReference = (value: StaticValue): boolean =>
  value.kind === "component-reference" &&
  (value.type.kind === "forward-ref" || value.type.kind === "memo" || value.type.kind === "lazy");

/**
 * Closures created from different source nodes are never the same object; the
 * same node evaluated in the same scope is the same closure (a component
 * declaration compared against an element's `type`).
 */
const compareClosureIdentity = (left: StaticValue, right: StaticValue): boolean | null => {
  const leftClosure = getClosureIdentity(left);
  const rightClosure = getClosureIdentity(right);
  if (leftClosure && rightClosure) {
    if (leftClosure.node !== rightClosure.node) return false;
    return leftClosure.scope === rightClosure.scope ? true : null;
  }
  if ((leftClosure && isWrapperReference(right)) || (rightClosure && isWrapperReference(left)))
    return false;
  return null;
};

/** Values the analyzed program itself creates, so never a host intrinsic such as `Function.prototype`. */
const isProgramAllocated = (value: StaticValue): boolean =>
  isHeapValue(value) || isCallableValue(value) || value.kind === "element";

const getElementTypeIdentity = (type: StaticElementType): object | null => {
  switch (type.kind) {
    case "function":
    case "class":
      return type.component.properties;
    case "memo":
    case "forward-ref":
    case "lazy":
      return type.properties;
    case "context-provider":
    case "context-consumer":
      return type.context;
    case "stub":
      return type.stub;
    default:
      return null;
  }
};

/** Element types share their statics map with the value they were created from. */
const getComponentIdentity = (value: StaticValue): object | null => {
  if (value.kind === "function") return value.boundThis ? null : value.properties;
  if (value.kind === "class") return value.properties;
  return value.kind === "component-reference" ? getElementTypeIdentity(value.type) : null;
};

/**
 * A host global is an object or function, or absent in environments without it
 * (`window` on a server), so it only ever equals `undefined`.
 */
const compareGlobalToPrimitive = (global: StaticValue, other: StaticValue): boolean | null => {
  if (global.kind !== "global" || other.kind !== "primitive") return null;
  return other.value === undefined ? null : false;
};

/**
 * A primitive of known type is never identical to a primitive of another
 * type, to `null`/`undefined`, or to a reference value.
 */
const compareTypedUnknownToOther = (typed: StaticValue, other: StaticValue): boolean | null => {
  if (typed.kind !== "unknown-primitive" || typed.primitiveType === "any") return null;
  if (other.kind === "primitive") {
    return typeof other.value === typed.primitiveType ? null : false;
  }
  if (other.kind === "unknown-primitive") {
    return other.primitiveType === "any" || other.primitiveType === typed.primitiveType
      ? null
      : false;
  }
  return getIdentityClass(other) === null ? null : false;
};

/** `===` decided the same way against every alternative, else undecided. */
const compareIdentityAcross = (alternatives: StaticValue[], other: StaticValue): boolean | null => {
  const first = compareIdentity(alternatives[0], other);
  if (first === null) return null;
  return alternatives.every((alternative) => compareIdentity(alternative, other) === first)
    ? first
    : null;
};

const INTRINSIC_GLOBAL_NAME = /^[A-Z]\w*(\.prototype)?$/;
const isIntrinsicGlobalName = (name: string): boolean => INTRINSIC_GLOBAL_NAME.test(name);

/** The document or global object, which native code hands back as this global rather than as a native object. */
const isHostObjectGlobal = (value: StaticValue): boolean =>
  value.kind === "global" && (value.name === "document" || value.name === GLOBAL_INTERFACE_NAME);

export const isSameComposition = (
  left: StringComposition | undefined,
  right: StringComposition | undefined,
): boolean =>
  left !== undefined &&
  right !== undefined &&
  left.source === right.source &&
  left.prefix === right.prefix &&
  left.suffix === right.suffix;

export const matchesComposition = (name: string, composition: StringComposition): boolean =>
  name.length >= composition.prefix.length + composition.suffix.length &&
  name.startsWith(composition.prefix) &&
  name.endsWith(composition.suffix);

const isEitherPrefix = (left: string, right: string): boolean =>
  left.startsWith(right) || right.startsWith(left);

const isEitherSuffix = (left: string, right: string): boolean =>
  left.endsWith(right) || right.endsWith(left);

/** Whether some string could read as both compositions, so a write under one may be read under the other. */
export const mayOverlapCompositions = (
  left: StringComposition,
  right: StringComposition,
): boolean =>
  isEitherPrefix(left.prefix, right.prefix) && isEitherSuffix(left.suffix, right.suffix);

/** Whether the dynamic string `value` may read as `text`, given the prefix, length or composition it is known to have. */
export const mayReadAsText = (value: StaticUnknownPrimitiveValue, text: string): boolean => {
  if (value.composition && !matchesComposition(text, value.composition)) return false;
  const shape = value.stringShape;
  if (!shape) return true;
  return text.startsWith(shape.prefix) && (shape.length === null || text.length === shape.length);
};

/**
 * `===` between two values, or null when analysis cannot decide. Import
 * bindings of the same external export are the same object; a primitive can
 * never be identical to a reference value.
 */
export const compareIdentity = (left: StaticValue, right: StaticValue): boolean | null => {
  if (left.kind === "primitive" && right.kind === "primitive") return left.value === right.value;
  if (left === right) return true;
  if (
    left.kind === "unknown-primitive" &&
    right.kind === "unknown-primitive" &&
    isSameComposition(left.composition, right.composition)
  )
    return true;
  if (left.kind === "function" && right.kind === "function" && left.scope !== right.scope) {
    return false;
  }
  if (left.kind === "branch") return compareIdentityAcross(left.alternatives, right);
  if (right.kind === "branch") return compareIdentityAcross(right.alternatives, left);
  if (isHeapValue(left) && isHeapValue(right) && left.allocation && right.allocation) {
    return left.allocation === right.allocation;
  }
  if (left.kind === "symbol" && right.kind === "symbol") return left.key === right.key;
  if (left.kind === "native-object" && right.kind === "native-object") {
    return left.value === right.value;
  }
  if (
    (isHostObjectGlobal(left) && right.kind === "native-object") ||
    (isHostObjectGlobal(right) && left.kind === "native-object")
  )
    return false;
  if (left.kind === "namespace" && right.kind === "namespace")
    return left.module.filePath === right.module.filePath;
  if (left.kind === "global" && right.kind === "global") {
    if (left.name === right.name) return true;
    if (isIntrinsicGlobalName(left.name) && isIntrinsicGlobalName(right.name)) return false;
  }
  if (
    (left.kind === "global" && isProgramAllocated(right)) ||
    (right.kind === "global" && isProgramAllocated(left))
  )
    return false;
  const globalVersusPrimitive =
    compareGlobalToPrimitive(left, right) ?? compareGlobalToPrimitive(right, left);
  if (globalVersusPrimitive !== null) return globalVersusPrimitive;
  if (left.kind === "react-api" && right.kind === "react-api") return left.api === right.api;
  const hostTagName = (value: StaticValue): string | null =>
    value.kind === "component-reference" && value.type.kind === "host" ? value.type.tagName : null;
  if (hostTagName(left) !== null && hostTagName(right) !== null)
    return hostTagName(left) === hostTagName(right);
  if (hostTagName(left) !== null && right.kind === "primitive")
    return hostTagName(left) === right.value;
  if (hostTagName(right) !== null && left.kind === "primitive")
    return hostTagName(right) === left.value;
  if (
    left.kind === "external" &&
    right.kind === "external" &&
    left.origin === "binding" &&
    right.origin === "binding"
  ) {
    return left.packageName === right.packageName &&
      left.importedName === right.importedName &&
      left.specifier === right.specifier
      ? true
      : null;
  }
  const closureIdentity = compareClosureIdentity(left, right);
  if (closureIdentity !== null) return closureIdentity;
  const typedVersusOther =
    compareTypedUnknownToOther(left, right) ?? compareTypedUnknownToOther(right, left);
  if (typedVersusOther !== null) return typedVersusOther;
  if (left.kind === "element" && right.kind === "element") {
    return left.props.allocation !== undefined && left.props.allocation === right.props.allocation;
  }
  const leftComponent = getComponentIdentity(left);
  const rightComponent = getComponentIdentity(right);
  if (leftComponent && rightComponent) return leftComponent === rightComponent;
  const leftClass = getIdentityClass(left);
  const rightClass = getIdentityClass(right);
  if (leftClass && rightClass && !canShareIdentityClass(leftClass, rightClass)) return false;
  if (leftClass === "object" && rightClass === "object" && left.kind !== right.kind) return false;
  if (leftClass === "scalar" && rightClass === "scalar") {
    const leftType = getScalarTypeof(left);
    const rightType = getScalarTypeof(right);
    return leftType !== null && rightType !== null && leftType !== rightType ? false : null;
  }
  return null;
};

/** `shallowEqual` as React and TanStack Store define it: same known keys, each identical (`Object.is`). */
export const compareShallowly = (left: StaticValue, right: StaticValue): boolean | null => {
  const identity = compareIdentity(left, right);
  if (identity === true || left.kind !== "object" || right.kind !== "object") return identity;
  const leftKeys = getKnownObjectKeys(left);
  const rightKeys = getKnownObjectKeys(right);
  if (!leftKeys || !rightKeys) return null;
  if (leftKeys.length !== rightKeys.length || !leftKeys.every((key) => rightKeys.includes(key))) {
    return false;
  }
  let isEqual: boolean | null = true;
  for (const key of leftKeys) {
    const same = compareIdentity(getObjectProperty(left, key), getObjectProperty(right, key));
    if (same === false) return false;
    if (same === null) isEqual = null;
  }
  return isEqual;
};

const MAX_EQUIVALENCE_DEPTH = 6;

const compareDeeplyAcross = (
  alternatives: StaticValue[],
  other: StaticValue,
  depth: number,
): boolean | null => {
  const first = compareDeeply(alternatives[0], other, depth);
  if (first === null) return null;
  return alternatives.every((alternative) => compareDeeply(alternative, other, depth) === first)
    ? first
    : null;
};

const compareDeeplyPairwise = (
  pairs: Array<[StaticValue, StaticValue]>,
  depth: number,
): boolean | null => {
  let isEqual: boolean | null = true;
  for (const [left, right] of pairs) {
    const same = compareDeeply(left, right, depth);
    if (same === false) return false;
    if (same === null) isEqual = null;
  }
  return isEqual;
};

const isPlainDataObject = (object: StaticObjectValue): boolean =>
  !object.constructedBy &&
  !object.prototype &&
  !object.hasNullPrototype &&
  object.entries.every((entry) => entry.kind === "spread" || !entry.accessor);

/**
 * Deep equality as lodash `isEqual` defines it: SameValueZero on primitives,
 * arrays by index, plain objects by own enumerable keys, identity otherwise.
 */
export const compareDeeply = (left: StaticValue, right: StaticValue, depth = 0): boolean | null => {
  if (left === right) return true;
  if (left.kind === "primitive" && right.kind === "primitive") {
    return left.value === right.value || (left.value !== left.value && right.value !== right.value);
  }
  if (left.kind === "branch") return compareDeeplyAcross(left.alternatives, right, depth);
  if (right.kind === "branch") return compareDeeplyAcross(right.alternatives, left, depth);
  const identity = compareIdentity(left, right);
  if (identity === true || depth >= MAX_EQUIVALENCE_DEPTH) return identity;
  if (left.kind === "primitive" || right.kind === "primitive") {
    return isProgramAllocated(left) || isProgramAllocated(right) ? false : identity;
  }
  if (left.kind === "list" && right.kind === "list") {
    if (!hasDefiniteItems(left) || !hasDefiniteItems(right)) return null;
    if (left.items.length !== right.items.length) return false;
    return compareDeeplyPairwise(
      left.items.map((item, index) => [item, right.items[index]]),
      depth + 1,
    );
  }
  if (left.kind === "object" && right.kind === "object") {
    if (!isPlainDataObject(left) || !isPlainDataObject(right)) return null;
    const leftKeys = getKnownObjectKeys(left);
    const rightKeys = getKnownObjectKeys(right);
    if (!leftKeys || !rightKeys) return null;
    if (leftKeys.length !== rightKeys.length || !leftKeys.every((key) => rightKeys.includes(key))) {
      return false;
    }
    return compareDeeplyPairwise(
      leftKeys.map((key) => [getObjectProperty(left, key), getObjectProperty(right, key)]),
      depth + 1,
    );
  }
  if (isHeapValue(left) && isHeapValue(right)) return false;
  return identity;
};

/**
 * Structural equivalence for detecting non-terminating recursion: dynamic
 * values are equivalent to each other because analysis can never tell them
 * apart, so a component re-rendering itself with them would never bottom out.
 */
export const areValuesEquivalent = (left: StaticValue, right: StaticValue, depth = 0): boolean => {
  if (isSameValue(left, right)) return true;
  if (left.kind !== right.kind) return false;
  if (depth >= MAX_EQUIVALENCE_DEPTH) return false;
  switch (left.kind) {
    case "unknown":
    case "unknown-primitive":
    case "global":
      return true;
    case "object": {
      if (right.kind !== "object") return false;
      const leftKeys = getKnownObjectKeys(left);
      const rightKeys = getKnownObjectKeys(right);
      if (!leftKeys || !rightKeys || leftKeys.length !== rightKeys.length)
        return !leftKeys && !rightKeys;
      return leftKeys.every(
        (key) =>
          rightKeys.includes(key) &&
          areValuesEquivalent(
            getObjectProperty(left, key),
            getObjectProperty(right, key),
            depth + 1,
          ),
      );
    }
    case "list":
      return (
        right.kind === "list" &&
        left.items.length === right.items.length &&
        left.items.every((item, index) => areValuesEquivalent(item, right.items[index], depth + 1))
      );
    case "repeat":
      return right.kind === "repeat" && areValuesEquivalent(left.item, right.item, depth + 1);
    case "optional":
      return right.kind === "optional" && areValuesEquivalent(left.value, right.value, depth + 1);
    case "branch":
      return (
        right.kind === "branch" &&
        left.alternatives.length === right.alternatives.length &&
        left.alternatives.every((alternative, index) =>
          areValuesEquivalent(alternative, right.alternatives[index], depth + 1),
        )
      );
    case "element":
      return (
        right.kind === "element" &&
        areElementTypesEquivalent(left.type, right.type) &&
        areValuesEquivalent(left.props, right.props, depth + 1)
      );
    case "function":
      return right.kind === "function" && left.node === right.node;
    case "symbol":
      return right.kind === "symbol" && left.key === right.key;
    case "external":
      return (
        right.kind === "external" &&
        left.packageName === right.packageName &&
        (left.importedName === right.importedName ||
          (left.origin !== "binding" && right.origin !== "binding"))
      );
    default:
      return false;
  }
};

const areElementTypesEquivalent = (left: StaticElementType, right: StaticElementType): boolean => {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "host":
      return right.kind === "host" && left.tagName === right.tagName;
    case "function":
    case "class":
      return (
        (right.kind === "function" || right.kind === "class") &&
        left.component.node === right.component.node
      );
    default:
      return true;
  }
};

const haveSameShape = (
  left: StaticUnknownPrimitiveValue,
  right: StaticUnknownPrimitiveValue,
): boolean =>
  left.stringShape?.prefix === right.stringShape?.prefix &&
  left.stringShape?.length === right.stringShape?.length &&
  (left.composition === right.composition ||
    isSameComposition(left.composition, right.composition)) &&
  left.numberRange?.min === right.numberRange?.min &&
  left.numberRange?.max === right.numberRange?.max;

const isSameLocation = (left: SourceLocation | null, right: SourceLocation | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.filePath === right.filePath &&
    left.line === right.line &&
    left.column === right.column);

/**
 * Two objects a single `throw` site allocates on different paths, whose own
 * properties are all indistinguishable scalars: nothing in the program can
 * tell which one it caught, so they share one alternative.
 */
const areInterchangeableThrownObjects = (
  left: StaticObjectValue,
  right: StaticObjectValue,
): boolean =>
  left.constructedBy === right.constructedBy &&
  left.hasNullPrototype === right.hasNullPrototype &&
  left.prototype === right.prototype &&
  left.entries.length === right.entries.length &&
  left.entries.every((entry, index) => {
    const other = right.entries[index];
    return (
      entry.kind === "property" &&
      other.kind === "property" &&
      entry.key === other.key &&
      entry.accessor === undefined &&
      other.accessor === undefined &&
      entry.value.kind !== "object" &&
      entry.value.kind !== "list" &&
      isInterchangeable(entry.value, other.value)
    );
  });

/** Alternatives analysis could never tell apart, so a branch keeps only one of them. */
const isInterchangeable = (left: StaticValue, right: StaticValue): boolean => {
  if (isSameValue(left, right)) return true;
  if (left === CHAIN_SHORT_CIRCUIT || right === CHAIN_SHORT_CIRCUIT) return false;
  if (left.kind === "unknown" && right.kind === "unknown") {
    if (left.thrown === undefined || right.thrown === undefined)
      return left.thrown === right.thrown;
    if (isInterchangeable(left.thrown, right.thrown)) return true;
    return (
      left.thrown.kind === "object" &&
      right.thrown.kind === "object" &&
      left.reason === right.reason &&
      isSameLocation(left.location, right.location) &&
      areInterchangeableThrownObjects(left.thrown, right.thrown)
    );
  }
  return (
    left.kind === "unknown-primitive" &&
    right.kind === "unknown-primitive" &&
    left.primitiveType === right.primitiveType &&
    haveSameShape(left, right)
  );
};

/**
 * Widening bound: a value joined at every iteration of an uncertain loop or on
 * every call into a stateful module (a scheduler's queue, a store's listener
 * list) accumulates one alternative per join, and each later join re-scans
 * them all. Past this many, the state is unknown rather than enumerated.
 */
const MAX_BRANCH_ALTERNATIVES = 64;

export const branchValue = (
  alternatives: StaticValue[],
  reason: string,
  location: SourceLocation | null = null,
  preferredIndex = 0,
  predicate: string | null = null,
): StaticValue => {
  const [firstAlternative] = alternatives;
  if (
    firstAlternative !== undefined &&
    alternatives.every((alternative) => isInterchangeable(alternative, firstAlternative))
  )
    return firstAlternative;
  const flattened: StaticValue[] = [];
  let resolvedPreferred = 0;
  const add = (value: StaticValue): number => {
    const existing = flattened.findIndex((candidate) => isInterchangeable(candidate, value));
    if (existing !== -1) return existing;
    flattened.push(value);
    return flattened.length - 1;
  };
  for (const [index, alternative] of alternatives.entries()) {
    const inner = alternative.kind === "branch" ? alternative.alternatives : [alternative];
    const innerPreferred = alternative.kind === "branch" ? alternative.preferredIndex : 0;
    for (const [innerIndex, value] of inner.entries()) {
      const position = add(value);
      if (index === preferredIndex && innerIndex === innerPreferred) resolvedPreferred = position;
      if (flattened.length > MAX_BRANCH_ALTERNATIVES) {
        return unknownValue(
          `${reason}: more than ${MAX_BRANCH_ALTERNATIVES} alternatives`,
          location,
        );
      }
    }
  }
  if (flattened.length === 1) return flattened[0];
  const isPositional =
    flattened.length === alternatives.length &&
    alternatives.every((alternative) => alternative.kind !== "branch");
  return {
    kind: "branch",
    alternatives: flattened,
    preferredIndex: resolvedPreferred,
    reason,
    location,
    predicate: isPositional ? predicate : null,
  };
};

const getAgreedTruthiness = (alternatives: StaticValue[]): boolean | null => {
  const truthiness = alternatives.map(getTruthiness);
  return truthiness.every((entry) => entry === truthiness[0]) ? (truthiness[0] ?? null) : null;
};

/** Truthiness an unknown primitive's shape already decides: a clock reading or a range that excludes zero, a string with known characters or a known length. */
const getShapedTruthiness = (value: StaticUnknownPrimitiveValue): boolean | null => {
  if (value.clock) return true;
  const range = value.numberRange;
  if (range && (range.min > 0 || range.max < 0)) return true;
  const shape = value.stringShape;
  if (shape) {
    if (shape.prefix.length > 0 || (shape.minLength ?? 0) > 0) return true;
    if (shape.length !== null) return shape.length > 0;
  }
  return null;
};

export const getTruthiness = (value: StaticValue): boolean | null => {
  switch (value.kind) {
    case "primitive":
      return Boolean(value.value);
    case "branch":
      return getAgreedTruthiness(value.alternatives);
    case "unknown-primitive":
      return getShapedTruthiness(value);
    case "unknown":
    case "optional":
      return null;
    case "external":
      return value.origin === "derived" ? null : true;
    case "element":
    case "list":
    case "repeat":
    case "object":
    case "function":
    case "class":
    case "regexp":
    case "symbol":
    case "component-reference":
    case "context":
    case "react-api":
    case "namespace":
    case "global":
    case "method":
    case "native-function":
    case "native-object":
    case "proxy":
      return true;
  }
};

/** `Boolean(value)` / `!!value`, keeping a branch's alternatives and preferred side. */
/** A decided comparison as `true`/`false`, an undecided one as an unknown boolean. */
export const decidedBooleanValue = (decision: boolean | null, reason: string): StaticValue =>
  decision === null
    ? unknownPrimitiveValue("boolean", reason)
    : decision
      ? TRUE_VALUE
      : FALSE_VALUE;

export const toBooleanValue = (value: StaticValue): StaticValue =>
  mapValue(value, (alternative) => {
    const truthiness = getTruthiness(alternative);
    if (truthiness === null) {
      return recordDerivation(
        unknownPrimitiveValue("boolean", `Boolean(${describeValue(alternative)})`),
        { kind: "alias", operand: alternative },
      );
    }
    return truthiness ? TRUE_VALUE : FALSE_VALUE;
  });

/** Truthiness along the alternative analysis prefers, so nested forks pick a consistent side. */
export const getPreferredTruthiness = (value: StaticValue): boolean | null =>
  value.kind === "branch"
    ? getPreferredTruthiness(value.alternatives[value.preferredIndex])
    : getTruthiness(value);

export type CallableValue = Extract<
  StaticValue,
  { kind: "function" | "native-function" | "global" }
>;

export const isCallable = (value: StaticValue | undefined): value is CallableValue =>
  value?.kind === "function" || value?.kind === "native-function" || value?.kind === "global";

/** `RegExp.prototype.toString`, the string a RegExp coerces to. */
export const regExpToString = (value: StaticRegExpValue): string =>
  `/${value.pattern}/${value.flags}`;

export const isNullish = (value: StaticValue): boolean | null => {
  if (value.kind === "primitive") return value.value === null || value.value === undefined;
  if (value.kind === "unknown" || value.kind === "branch") return null;
  if (value.kind === "unknown-primitive") return value.primitiveType === "any" ? null : false;
  return false;
};

/** The alternatives of `value` that can be truthy; `value` itself when it is not a branch. */
export const truthyCounterpart = (value: StaticValue): StaticValue => {
  if (value.kind !== "branch") return value;
  const truthy = value.alternatives.filter((alternative) => getTruthiness(alternative) !== false);
  return truthy.length === 0 ? value : branchValue(truthy, value.reason, value.location);
};

export const falsyCounterpart = (value: StaticValue): StaticValue => {
  if (value.kind === "branch") {
    const falsy = value.alternatives.filter((alternative) => getTruthiness(alternative) !== true);
    return falsy.length === 0
      ? UNDEFINED_VALUE
      : branchValue(falsy.map(falsyCounterpart), value.reason, value.location);
  }
  if (value.kind === "primitive") return value;
  if (value.kind === "unknown-primitive") {
    switch (value.primitiveType) {
      case "number":
        return primitiveValue(0);
      case "string":
        return primitiveValue("");
      case "boolean":
        return FALSE_VALUE;
      case "any":
        return UNDEFINED_VALUE;
    }
  }
  return UNDEFINED_VALUE;
};

export const mapValue = (
  value: StaticValue,
  transform: (alternative: StaticValue, index: number) => StaticValue,
): StaticValue => {
  if (value.kind !== "branch") return transform(value, 0);
  return joinMappedAlternatives(
    value,
    value.alternatives.map((alternative, index) => transform(alternative, index)),
  );
};

/** Rebuilds `source` around one mapped value per alternative, keeping the decision it stands for. */
export const joinMappedAlternatives = (
  source: StaticBranchValue,
  alternatives: StaticValue[],
): StaticValue => {
  const mapped = branchValue(
    alternatives,
    source.reason,
    source.location,
    source.preferredIndex,
    source.predicate,
  );
  if (
    mapped.kind === "branch" &&
    mapped.predicate === null &&
    alternatives.every((alternative) => alternative.kind !== "branch")
  ) {
    recordBranchOrigin(mapped, source);
  }
  return mapped;
};

const MAX_DISTRIBUTED_ALTERNATIVES = 16;

export const countAlternatives = (value: StaticValue): number =>
  value.kind === "branch" ? value.alternatives.length : 1;

/** Applies a binary operation to every pair of alternatives while the product stays small; null when either operand is a branch too wide to distribute. */
export const distributeBinary = (
  left: StaticValue,
  right: StaticValue,
  operation: (leftAlternative: StaticValue, rightAlternative: StaticValue) => StaticValue,
): StaticValue | null => {
  if (
    left.kind === "branch" &&
    right.kind === "branch" &&
    left.predicate !== null &&
    left.predicate === right.predicate &&
    left.alternatives.length === right.alternatives.length
  ) {
    return mapValue(left, (alternative, index) =>
      operation(alternative, right.alternatives[index]),
    );
  }
  if (countAlternatives(left) * countAlternatives(right) > MAX_DISTRIBUTED_ALTERNATIVES)
    return null;
  if (left.kind === "branch") {
    return mapValue(left, (alternative) => operation(alternative, right));
  }
  if (right.kind === "branch") {
    return mapValue(right, (alternative) => operation(left, alternative));
  }
  return null;
};

type StructureDecision = string | StaticBranchValue;

interface StructureInstance {
  value: StaticValue;
  decisions: Map<StructureDecision, number>;
  isPreferred: boolean;
}

interface SequenceInstance {
  values: StaticValue[];
  decisions: Map<StructureDecision, number>;
  isPreferred: boolean;
}

interface StructureExpansion {
  limit: number;
  firstBranch: StaticBranchValue | null;
}

const expandSequence = (
  values: StaticValue[],
  decisions: Map<StructureDecision, number>,
  isPreferred: boolean,
  expansion: StructureExpansion,
): SequenceInstance[] | null => {
  let partials: SequenceInstance[] = [{ values: [], decisions, isPreferred }];
  for (const value of values) {
    const next: SequenceInstance[] = [];
    for (const partial of partials) {
      const instances = expandStructure(value, partial.decisions, partial.isPreferred, expansion);
      if (instances === null) return null;
      for (const instance of instances) {
        next.push({
          values: [...partial.values, instance.value],
          decisions: instance.decisions,
          isPreferred: instance.isPreferred,
        });
      }
      if (next.length > expansion.limit) return null;
    }
    partials = next;
  }
  return partials;
};

const expandStructure = (
  value: StaticValue,
  decisions: Map<StructureDecision, number>,
  isPreferred: boolean,
  expansion: StructureExpansion,
): StructureInstance[] | null => {
  switch (value.kind) {
    case "branch": {
      expansion.firstBranch ??= value;
      const key: StructureDecision = value.predicate ?? value;
      const decided = decisions.get(key);
      if (decided !== undefined && decided < value.alternatives.length) {
        return expandStructure(value.alternatives[decided], decisions, isPreferred, expansion);
      }
      const instances: StructureInstance[] = [];
      for (const [index, alternative] of value.alternatives.entries()) {
        const chosen = new Map(decisions).set(key, index);
        const expanded = expandStructure(
          alternative,
          chosen,
          isPreferred && index === value.preferredIndex,
          expansion,
        );
        if (expanded === null) return null;
        instances.push(...expanded);
        if (instances.length > expansion.limit) return null;
      }
      return instances;
    }
    case "object": {
      const expanded = expandSequence(
        value.entries.map((entry) => entry.value),
        decisions,
        isPreferred,
        expansion,
      );
      return (
        expanded?.map((instance) => ({
          value: instance.values.every(
            (entryValue, index) => entryValue === value.entries[index].value,
          )
            ? value
            : {
                ...value,
                entries: value.entries.map((entry, index) => ({
                  ...entry,
                  value: instance.values[index],
                })),
              },
          decisions: instance.decisions,
          isPreferred: instance.isPreferred,
        })) ?? null
      );
    }
    case "list": {
      const expanded = expandSequence(value.items, decisions, isPreferred, expansion);
      return (
        expanded?.map((instance) => ({
          value: instance.values.every((item, index) => item === value.items[index])
            ? value
            : { ...value, items: instance.values },
          decisions: instance.decisions,
          isPreferred: instance.isPreferred,
        })) ?? null
      );
    }
    default:
      return [{ value, decisions, isPreferred }];
  }
};

/**
 * Hoists branches nested anywhere inside an object or list into one branch of
 * fully concrete structures. Branches sharing a predicate take the same
 * alternative in every instance. Past `limit` instances the value is returned
 * as is, still holding its branches.
 */
export const distributeObjectBranches = (
  value: StaticValue,
  limit = MAX_DISTRIBUTED_ALTERNATIVES,
): StaticValue => {
  const expansion: StructureExpansion = { limit, firstBranch: null };
  const instances = expandStructure(value, new Map(), true, expansion);
  if (instances === null || instances.length < 2 || expansion.firstBranch === null) return value;
  if (
    value.kind === "branch" &&
    instances.every((instance, index) => instance.value === value.alternatives[index])
  ) {
    return value;
  }
  const keys = new Set(instances.flatMap((instance) => [...instance.decisions.keys()]));
  const [onlyKey] = keys;
  const predicate = keys.size === 1 && typeof onlyKey === "string" ? onlyKey : null;
  return branchValue(
    instances.map((instance) => instance.value),
    expansion.firstBranch.reason,
    expansion.firstBranch.location,
    Math.max(
      0,
      instances.findIndex((instance) => instance.isPreferred),
    ),
    predicate,
  );
};

export const isIndefiniteItem = (item: StaticValue): boolean =>
  item.kind === "repeat" || item.kind === "optional";

const getItemCountRange = (item: StaticValue): NumberRange => {
  if (item.kind === "repeat") return item.count ?? { min: 0, max: Number.POSITIVE_INFINITY };
  return item.kind === "optional" ? { min: 0, max: 1 } : { min: 1, max: 1 };
};

/** Inclusive bounds of how many elements `items` stand for. */
export const getItemsCountRange = (items: StaticValue[]): NumberRange => {
  const ranges = items.map(getItemCountRange);
  return {
    min: ranges.reduce((total, range) => total + range.min, 0),
    max: ranges.reduce((total, range) => total + range.max, 0),
  };
};

export const getListLength = (list: StaticListValue): StaticValue => {
  if (!list.items.some(isIndefiniteItem)) return primitiveValue(list.items.length);
  return {
    ...unknownPrimitiveValue("number", "length of a partially known list"),
    numberRange: getItemsCountRange(list.items),
  };
};

const MAX_LIST_GROWTH = 1_000;

/** The array index a property key names, as `"3"` does and `"03"` or `"-1"` do not. */
export const toIndexKey = (key: string): number | null => {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && String(index) === key ? index : null;
};

/**
 * `list[index] = value`: fills holes up to `index` with `undefined` like JavaScript
 * does. Past a partially known prefix the slot the write lands on is unknown, so
 * the indefinite tail becomes an unknown repeat.
 */
export const setListItem = (list: StaticListValue, index: number, value: StaticValue): void => {
  const indefiniteIndex = list.items.findIndex(isIndefiniteItem);
  if (indefiniteIndex !== -1 && index >= indefiniteIndex) {
    list.items.splice(
      indefiniteIndex,
      list.items.length - indefiniteIndex,
      repeatItem(unknownValue("item of a partially known list written by index")),
    );
    return;
  }
  if (index - list.items.length > MAX_LIST_GROWTH) {
    list.items.push(repeatItem(UNDEFINED_VALUE), value);
    return;
  }
  while (list.items.length < index) list.items.push(UNDEFINED_VALUE);
  list.items[index] = value;
};

/** `list.length = length`: truncates or extends with holes; an unknown length leaves every item uncertain. */
export const setListLength = (list: StaticListValue, length: number | null): void => {
  if (length === null) {
    list.items.splice(
      0,
      list.items.length,
      repeatItem(unknownValue("item of a list resized to an unknown length")),
    );
    return;
  }
  const indefiniteIndex = list.items.findIndex(isIndefiniteItem);
  if (indefiniteIndex !== -1 && length > indefiniteIndex) {
    list.items.splice(
      indefiniteIndex,
      list.items.length - indefiniteIndex,
      repeatItem(unknownValue("item of a partially known list resized by length")),
    );
    return;
  }
  if (length - list.items.length > MAX_LIST_GROWTH) {
    list.items.push(repeatItem(UNDEFINED_VALUE));
    return;
  }
  while (list.items.length < length) list.items.push(UNDEFINED_VALUE);
  list.items.length = length;
};

const repeatItem = (item: StaticValue): StaticValue => ({ kind: "repeat", item, location: null });

/** Every item is present with certainty (it may still be a branch of values). */
export const hasDefiniteItems = (value: StaticValue): value is StaticListValue =>
  value.kind === "list" && !value.items.some(isIndefiniteItem);

/** Own enumerable string-keyed entries in `Object.keys` order; null when the shape is not fully known. */
export const getOwnEnumerableEntries = (
  target: StaticValue,
): [key: string, value: StaticValue][] | null => {
  if (target.kind === "object") {
    return getKnownObjectKeys(target)?.map((key) => [key, getObjectProperty(target, key)]) ?? null;
  }
  if (target.kind === "class") {
    return [...target.properties].filter(
      ([key]) =>
        !isSymbolPropertyKey(key) &&
        !target.body.members.some(
          (member) => member.isStatic && member.kind === "method" && member.key === key,
        ),
    );
  }
  if (target.kind === "function") {
    return [...target.properties].filter(
      ([key]) => key !== "prototype" && !isSymbolPropertyKey(key),
    );
  }
  if (!hasDefiniteItems(target)) return null;
  return [
    ...target.items.map((item, index): [string, StaticValue] => [String(index), item]),
    ...[...(target.properties ?? [])].filter(([key]) => !target.nonEnumerableKeys?.has(key)),
  ];
};

export const isKnownList = (value: StaticValue): value is StaticListValue =>
  hasDefiniteItems(value) && value.items.every((item) => item.kind !== "branch");

export const optionalValue = (
  value: StaticValue,
  reason: string,
  location: SourceLocation | null = null,
  isAbsentPreferred = false,
): StaticOptionalValue => ({ kind: "optional", value, reason, location, isAbsentPreferred });

/**
 * Items contributed by `...value` inside an array literal (also `concat`,
 * `flatMap`). A branch over lists stays positional when every alternative has
 * the same length, becomes one optional item when the alternatives are `[x]`
 * and `[]`, and otherwise collapses to a repeat over everything it could hold.
 */
export const spreadListItems = (
  value: StaticValue,
  location: SourceLocation | null,
): StaticValue[] => {
  if (value.kind === "list") return value.items;
  if (value.kind === "primitive" && typeof value.value === "string") {
    return [...value.value].map((character) => primitiveValue(character));
  }
  if (value.kind === "repeat") return [value];
  if (value.kind === "optional") {
    return spreadListItems(value.value, location).map((item) =>
      item.kind === "repeat"
        ? item
        : optionalValue(item, value.reason, value.location, value.isAbsentPreferred),
    );
  }
  if (value.kind === "branch" && value.alternatives.every(hasDefiniteItems)) {
    const lists = value.alternatives.filter(hasDefiniteItems);
    const lengths = new Set(lists.map((list) => list.items.length));
    if (lengths.size === 1) {
      return lists[0].items.map((_, index) =>
        branchValue(
          lists.map((list) => list.items[index]),
          value.reason,
          value.location,
          value.preferredIndex,
          value.predicate,
        ),
      );
    }
    const present = lists.filter((list) => list.items.length > 0);
    if (present.every((list) => list.items.length === 1)) {
      const item = branchValue(
        present.map((list) => list.items[0]),
        value.reason,
        value.location,
        Math.max(0, present.indexOf(lists[value.preferredIndex])),
      );
      return [
        optionalValue(
          item,
          value.reason,
          value.location,
          lists[value.preferredIndex].items.length === 0,
        ),
      ];
    }
    return [
      {
        kind: "repeat",
        item: branchValue(
          lists.flatMap((list) => list.items),
          value.reason,
          value.location,
        ),
        location,
      },
    ];
  }
  return [{ kind: "repeat", item: unknownValue(`spread of ${describeValue(value)}`), location }];
};

const MAX_OPTIONAL_CANDIDATES = 8;

/**
 * `items[index]` when some earlier items may be absent: each optional item
 * either occupies a position or does not, so the result is a branch over the
 * items that could land on `index`.
 */
export const getListItem = (
  items: StaticValue[],
  index: number,
  location: SourceLocation | null,
): StaticValue => {
  const candidates: StaticValue[] = [];
  const pick = (remaining: StaticValue[], offset: number): boolean => {
    let position = 0;
    let remainingOffset = offset;
    while (candidates.length <= MAX_OPTIONAL_CANDIDATES) {
      const head = remaining[position];
      if (head === undefined) {
        candidates.push(UNDEFINED_VALUE);
        return true;
      }
      if (head.kind === "repeat") return false;
      if (head.kind === "optional") {
        const rest = remaining.slice(position + 1);
        return head.isAbsentPreferred
          ? pick(rest, remainingOffset) && pick([head.value, ...rest], remainingOffset)
          : pick([head.value, ...rest], remainingOffset) && pick(rest, remainingOffset);
      }
      if (remainingOffset === 0) {
        candidates.push(head);
        return true;
      }
      position += 1;
      remainingOffset -= 1;
    }
    return false;
  };
  if (!pick(items, index)) {
    return unknownValue(`index ${index} of a partially known list`, location);
  }
  if (candidates.length === 1) return candidates[0];
  return branchValue(candidates, `item ${index} of a filtered list`, location);
};

const MAX_DESCRIPTION_DEPTH = 3;

export const describeValue = (value: StaticValue, depth = 0): string => {
  if (depth >= MAX_DESCRIPTION_DEPTH) return "…";
  const describeNested = (nested: StaticValue): string => describeValue(nested, depth + 1);
  switch (value.kind) {
    case "primitive":
      return typeof value.value === "string" ? JSON.stringify(value.value) : String(value.value);
    case "unknown-primitive":
      return depth === 0 ? `<${value.primitiveType}: ${value.reason}>` : `<${value.primitiveType}>`;
    case "element":
      return `<${describeElementType(value.type)}>`;
    case "list":
      return `[${value.items.map(describeNested).join(", ")}]`;
    case "repeat":
      return `repeat(${describeNested(value.item)})`;
    case "branch":
      return `branch(${value.alternatives.map(describeNested).join(" | ")})`;
    case "optional":
      return `optional(${describeNested(value.value)})`;
    case "regexp":
      return `/${value.pattern}/${value.flags}`;
    case "symbol":
      if (unregisteredSymbols.has(value.key))
        return `Symbol(${value.description === undefined ? "" : JSON.stringify(value.description)})`;
      return value.key.startsWith("Symbol.")
        ? value.key
        : `Symbol.for(${JSON.stringify(value.key)})`;
    case "object":
      return `{${value.entries.map((entry) => (entry.kind === "property" ? entry.key : "...")).join(", ")}}`;
    case "function":
      return `function ${value.name ?? "<anonymous>"}`;
    case "class":
      return `class ${value.name ?? "<anonymous>"}`;
    case "component-reference":
      return `component ${describeElementType(value.type)}`;
    case "context":
      return `context ${value.context.name}`;
    case "react-api":
      return `React.${value.api}`;
    case "external":
      return `${value.packageName}#${value.importedName}`;
    case "namespace":
      return `namespace ${value.module.filePath}`;
    case "global":
      return `global ${value.name}`;
    case "method":
      return `${describeNested(value.receiver)}.${value.name}`;
    case "native-function":
      return `native ${value.name}`;
    case "native-object":
      return `native ${Object.prototype.toString.call(value.value).slice("[object ".length, -1)}`;
    case "proxy":
      return `proxy of ${describeNested(value.target)}`;
    case "unknown":
      return depth === 0 ? `unknown(${value.reason})` : "unknown";
  }
};

/** The name React reports for a stub: a `displayName` the app assigned wins over the library's. */
export const getStubDisplayName = (stub: StubComponent): string | null => {
  const assigned = stub.properties?.get("displayName");
  return assigned?.kind === "primitive" && typeof assigned.value === "string"
    ? assigned.value
    : stub.displayName;
};

export const describeElementType = (type: StaticElementType): string => {
  switch (type.kind) {
    case "host":
      return type.tagName;
    case "function":
    case "class":
      return type.component.name ?? "Anonymous";
    case "memo":
      return type.displayName ?? `memo(${describeElementType(type.inner)})`;
    case "forward-ref":
      return type.displayName ?? type.component.name ?? "ForwardRef";
    case "lazy":
      return type.displayName ?? (type.inner ? describeElementType(type.inner) : "lazy");
    case "fragment":
      return "Fragment";
    case "strict-mode":
      return "StrictMode";
    case "profiler":
      return "Profiler";
    case "suspense":
      return "Suspense";
    case "suspense-list":
      return "SuspenseList";
    case "activity":
      return "Activity";
    case "view-transition":
      return "ViewTransition";
    case "context-provider":
      return type.displayName ?? `${type.context?.name ?? "Context"}.Provider`;
    case "context-consumer":
      return type.displayName ?? `${type.context?.name ?? "Context"}.Consumer`;
    case "portal":
      return "Portal";
    case "external":
      return type.displayName;
    case "stub":
      return getStubDisplayName(type.stub) ?? "anonymous stub";
    case "unknown":
      return type.displayName ?? "unknown";
  }
};

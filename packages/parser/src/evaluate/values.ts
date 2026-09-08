import { getCapturedExportReference, getOpaqueCaptureDescription } from "../observations.js";
import type { Class } from "oxc-parser";
import type {
  CapturedExportReference,
  CapturedValue,
  FunctionLikeNode,
  JsonValue,
  Scope,
  SourceLocation,
  StaticAccessor,
  StaticClassValue,
  StaticElementType,
  StaticFunctionValue,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticOptionalValue,
  StaticPrimitive,
  StaticPrimitiveValue,
  StaticSymbolValue,
  StaticUnknownPrimitiveValue,
  StaticUnknownValue,
  StaticValue,
  StubComponent,
  UnknownPrimitiveType,
} from "../types.js";
import { getExternalMember, getReactApiTypeof } from "../react/react-api.js";

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

/** A newly allocated array: `===` to no other value analysis constructs. */
export const listValue = (items: StaticValue[]): StaticListValue => ({
  kind: "list",
  items,
  allocation: ++allocationCount,
});

/** `Class.__proto__` / `Object.getPrototypeOf(Class)`: the parent class, or `Function.prototype` for a base class. */
export const getClassPrototype = (classValue: StaticClassValue): StaticValue =>
  classValue.body.superValue ?? { kind: "global", name: "Function.prototype" };

/** A newly allocated object: `===` to no other value analysis constructs. */
export const objectValue = (entries: StaticObjectEntry[] = []): StaticObjectValue => ({
  kind: "object",
  entries,
  allocation: ++allocationCount,
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

/** Evaluates the module export a captured node referenced; null when the module is not part of the analyzed project. */
export interface CapturedExportResolver {
  (reference: CapturedExportReference): StaticValue | null;
}

const NO_EXPORTS: CapturedExportResolver = () => null;

/** A value serialized whole from a running page: every key is known, and nodes JSON could not carry stay unknown. */
export const capturedValue = (
  captured: CapturedValue,
  name: string,
  resolveExport: CapturedExportResolver = NO_EXPORTS,
): StaticValue => {
  if (captured === null || typeof captured !== "object") return primitiveValue(captured);
  if (Array.isArray(captured)) {
    return listValue(
      captured.map((item, index) => capturedValue(item, `${name}[${index}]`, resolveExport)),
    );
  }
  const opaque = getOpaqueCaptureDescription(captured);
  if (opaque !== null) return unknownValue(`${name}: ${opaque} recorded from the page`);
  const reference = getCapturedExportReference(captured);
  if (reference !== null) {
    return (
      resolveExport(reference) ??
      unknownValue(
        `${name}: export "${reference.name}" of ${reference.module} recorded from the page`,
      )
    );
  }
  return objectValue(
    Object.entries(captured).map(([key, item]): StaticObjectEntry => ({
      kind: "property",
      key,
      value: capturedValue(item, `${name}.${key}`, resolveExport),
    })),
  );
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
): StaticObjectEntry => ({
  kind: "property",
  key,
  value: unknownValue(`accessor property "${key}"`, location),
  accessor,
});

/**
 * Results of the lookup in progress. Objects spread through many branches
 * (`state = cond ? {...state, ...next} : state` repeated) are reached once per
 * path otherwise, and nothing mutates while a lookup runs.
 */
let lookupMemo: Map<StaticObjectValue, Map<string, StaticValue>> | null = null;

export const getObjectProperty = (object: StaticObjectValue, key: string): StaticValue => {
  if (lookupMemo) return getMemoizedObjectProperty(lookupMemo, object, key);
  lookupMemo = new Map();
  try {
    return getMemoizedObjectProperty(lookupMemo, object, key);
  } finally {
    lookupMemo = null;
  }
};

const getMemoizedObjectProperty = (
  memo: Map<StaticObjectValue, Map<string, StaticValue>>,
  object: StaticObjectValue,
  key: string,
): StaticValue => {
  let properties = memo.get(object);
  const memoized = properties?.get(key);
  if (memoized) return memoized;
  const value = lookupObjectProperty(object, key);
  if (!properties) {
    properties = new Map();
    memo.set(object, properties);
  }
  properties.set(key, value);
  return value;
};

const isPresent = (value: StaticValue): boolean =>
  value.kind !== "primitive" || value.value !== undefined;

const lookupObjectProperty = (object: StaticObjectValue, key: string): StaticValue => {
  for (let index = object.entries.length - 1; index >= 0; index--) {
    const entry = object.entries[index];
    if (entry.kind === "property") {
      if (entry.key === key) return entry.value;
      continue;
    }
    const spread = entry.value;
    if (spread.kind === "object") {
      const nested = getObjectProperty(spread, key);
      if (isPresent(nested)) return nested;
      continue;
    }
    if (spread.kind === "primitive" || spread.kind === "function" || spread.kind === "class")
      continue;
    if (spread.kind === "external" && spread.importedName === "*" && spread.origin === "binding")
      return getExternalMember(spread, key);
    if (spread.kind === "branch") {
      let fromEarlier: StaticValue | null = null;
      return branchValue(
        spread.alternatives.map((alternative) => {
          const own = getSpreadProperty(alternative, key);
          if (isPresent(own)) return own;
          fromEarlier ??= getObjectProperty(objectValue(object.entries.slice(0, index)), key);
          return fromEarlier;
        }),
        spread.reason,
        spread.location,
        spread.preferredIndex,
        spread.predicate,
      );
    }
    const fromSpread = unknownValue(
      `property "${key}" may come from a spread of ${describeValue(spread)}`,
    );
    const fromEarlier = getObjectProperty(objectValue(object.entries.slice(0, index)), key);
    if (isPresent(fromEarlier))
      return branchValue([fromEarlier, fromSpread], fromSpread.reason, null);
    const inherited = getInheritedProperty(object, key);
    return isPresent(inherited) ? inherited : fromSpread;
  }
  return getInheritedProperty(object, key);
};

const getInheritedProperty = (object: StaticObjectValue, key: string): StaticValue => {
  if (key === "constructor" && object.constructedBy) return object.constructedBy;
  return object.prototype ? getObjectProperty(object.prototype, key) : UNDEFINED_VALUE;
};

const getSpreadProperty = (spread: StaticValue, key: string): StaticValue =>
  spread.kind === "object"
    ? getObjectProperty(spread, key)
    : getObjectProperty(objectValue([{ kind: "spread", value: spread }]), key);

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
  const symbol: StaticSymbolValue = { kind: "symbol", key: `#${++allocationCount}` };
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

/** The property name a computed key denotes, or `null` when the key is not statically known. */
export const getPropertyName = (key: StaticValue): string | null => {
  if (key.kind === "primitive") return String(key.value);
  return key.kind === "symbol" ? getSymbolPropertyKey(key) : null;
};

const getKnownOwnKeys = (
  object: StaticObjectValue,
  isIncluded: (key: string) => boolean,
): string[] | null => {
  const keys: string[] = [];
  for (const entry of object.entries) {
    const entryKeys = entry.kind === "property" ? [entry.key] : getKnownSpreadKeys(entry.value);
    if (!entryKeys) return null;
    for (const key of entryKeys) {
      if (isIncluded(key) && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
};

export const getKnownObjectKeys = (object: StaticObjectValue): string[] | null =>
  getKnownOwnKeys(object, (key) => !isSymbolPropertyKey(key));

/** `Object.getOwnPropertyDescriptor(object, key)`, or null when a dynamic spread could own `key`. */
export const getOwnPropertyDescriptor = (
  object: StaticObjectValue,
  key: string,
): StaticValue | null => {
  const ownKeys = getKnownOwnKeys(object, () => true);
  if (!ownKeys) return null;
  if (!ownKeys.includes(key)) return UNDEFINED_VALUE;
  const isConfigurable = primitiveValue(object.isFrozen !== true);
  const accessor = getObjectAccessor(object, key);
  if (accessor) {
    return objectFromRecord({
      get: accessor.get ?? UNDEFINED_VALUE,
      set: accessor.set ?? UNDEFINED_VALUE,
      enumerable: TRUE_VALUE,
      configurable: isConfigurable,
    });
  }
  return objectFromRecord({
    value: getObjectProperty(object, key),
    writable: isConfigurable,
    enumerable: TRUE_VALUE,
    configurable: isConfigurable,
  });
};

/** `Object.getOwnPropertyDescriptors(object)`, or null when a dynamic spread could own a key. */
export const getOwnPropertyDescriptors = (object: StaticObjectValue): StaticObjectValue | null => {
  const ownKeys = getKnownOwnKeys(object, () => true);
  if (!ownKeys) return null;
  const descriptors: Record<string, StaticValue> = {};
  for (const key of ownKeys) {
    const descriptor = getOwnPropertyDescriptor(object, key);
    if (descriptor === null) return null;
    descriptors[key] = descriptor;
  }
  return objectFromRecord(descriptors);
};

/** The symbols keying own properties, as `Object.getOwnPropertySymbols` lists them. */
export const getKnownObjectSymbols = (object: StaticObjectValue): StaticSymbolValue[] | null =>
  getKnownOwnKeys(object, isSymbolPropertyKey)?.map((propertyKey) => {
    const key = propertyKey.slice(SYMBOL_PROPERTY_KEY_PREFIX.length);
    return unregisteredSymbols.get(key) ?? { kind: "symbol", key };
  }) ?? null;

const getKnownSpreadKeys = (spread: StaticValue): string[] | null => {
  switch (spread.kind) {
    case "object":
      return getKnownOwnKeys(spread, () => true);
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

const getOwnPropertyValue = (entries: StaticObjectEntry[], key: string): StaticValue | null => {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.kind === "property" && entry.key === key) return entry.value;
  }
  return null;
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
  const isExtension = (entries: StaticObjectEntry[]): boolean =>
    entries.length >= original.length && original.every((entry, index) => entries[index] === entry);
  const appended = pathEntries.map((entries) =>
    isExtension(entries) ? entries.slice(original.length) : null,
  );
  const keys = new Set<string>();
  for (const entries of appended) {
    if (!entries || entries.some((entry) => entry.kind === "spread")) {
      const alternatives = pathEntries.map((entries, index) =>
        objectValue(appended[index] ?? entries),
      );
      return [
        ...original,
        {
          kind: "spread",
          value: branchValue(alternatives, reason, location, preferredIndex, predicate),
        },
      ];
    }
    for (const entry of entries) if (entry.kind === "property") keys.add(entry.key);
  }
  const entryObject = objectValue(original);
  return [
    ...original,
    ...[...keys].map((key): StaticObjectEntry => ({
      kind: "property",
      key,
      value: branchValue(
        appended.map(
          (entries) =>
            getOwnPropertyValue(entries ?? [], key) ?? getObjectProperty(entryObject, key),
        ),
        reason,
        location,
        preferredIndex,
        predicate,
      ),
    })),
  ];
};

export const omitObjectKeys = (object: StaticObjectValue, omitted: Set<string>): StaticValue => {
  const entries: StaticObjectEntry[] = [];
  for (const entry of object.entries) {
    if (entry.kind === "property") {
      if (!omitted.has(entry.key)) entries.push(entry);
      continue;
    }
    if (entry.value.kind === "object") {
      const nested = omitObjectKeys(entry.value, omitted);
      entries.push({ kind: "spread", value: nested });
      continue;
    }
    if (entry.value.kind === "primitive") continue;
    if (entry.value.kind === "branch") {
      const rest = mapValue(entry.value, (alternative) =>
        omitObjectKeys(objectValue([{ kind: "spread", value: alternative }]), omitted),
      );
      entries.push({ kind: "spread", value: rest });
      continue;
    }
    return unknownValue(`rest of ${describeValue(entry.value)}`);
  }
  return objectValue(entries);
};

/** `delete object[key]`: an own property vanishes; one a dynamic spread may hold stays as uncertain as that spread. */
export const deleteObjectProperty = (object: StaticObjectValue, key: string): void => {
  const remaining = omitObjectKeys(object, new Set([key]));
  object.entries.splice(
    0,
    object.entries.length,
    ...(remaining.kind === "object"
      ? remaining.entries
      : object.entries.filter((entry) => entry.kind === "spread" || entry.key !== key)),
  );
};

export const componentReference = (type: StaticElementType): StaticValue => ({
  kind: "component-reference",
  type,
});

const isSameValue = (left: StaticValue, right: StaticValue): boolean => {
  if (left === right) return true;
  if (left.kind === "primitive" && right.kind === "primitive") {
    return Object.is(left.value, right.value);
  }
  if (left.kind === "global" && right.kind === "global") return left.name === right.name;
  if (left.kind === "symbol" && right.kind === "symbol") return left.key === right.key;
  return false;
};

const REFERENCE_KINDS = new Set<StaticValue["kind"]>([
  "element",
  "list",
  "object",
  "function",
  "class",
  "regexp",
  "context",
  "native-function",
  "proxy",
  "native-object",
  "method",
  "react-api",
  "component-reference",
  "namespace",
]);

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
const getIdentityClass = (value: StaticValue): "scalar" | "symbol" | "reference" | null => {
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

/**
 * `===` between two values, or null when analysis cannot decide. Import
 * bindings of the same external export are the same object; a primitive can
 * never be identical to a reference value.
 */
export const compareIdentity = (left: StaticValue, right: StaticValue): boolean | null => {
  if (left.kind === "primitive" && right.kind === "primitive") return left.value === right.value;
  if (left === right) return true;
  if (left.kind === "function" && right.kind === "function" && left.scope !== right.scope) {
    return false;
  }
  if (left.kind === "branch") return compareIdentityAcross(left.alternatives, right);
  if (right.kind === "branch") return compareIdentityAcross(right.alternatives, left);
  if (isHeapValue(left) && isHeapValue(right) && left.allocation && right.allocation) {
    return left.allocation === right.allocation;
  }
  if (left.kind === "symbol" && right.kind === "symbol") return left.key === right.key;
  if (left.kind === "namespace" && right.kind === "namespace") {
    return left.module.filePath === right.module.filePath;
  }
  if (left.kind === "global" && right.kind === "global") {
    if (left.name === right.name) return true;
    if (left.name.endsWith(".prototype") && right.name.endsWith(".prototype")) return false;
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
    return left.packageName === right.packageName && left.importedName === right.importedName
      ? true
      : null;
  }
  const closureIdentity = compareClosureIdentity(left, right);
  if (closureIdentity !== null) return closureIdentity;
  const typedVersusOther =
    compareTypedUnknownToOther(left, right) ?? compareTypedUnknownToOther(right, left);
  if (typedVersusOther !== null) return typedVersusOther;
  if (left.kind === "element" && right.kind === "element") return false;
  const leftComponent = getComponentIdentity(left);
  const rightComponent = getComponentIdentity(right);
  if (leftComponent && rightComponent) return leftComponent === rightComponent;
  const leftClass = getIdentityClass(left);
  const rightClass = getIdentityClass(right);
  if (leftClass && rightClass && leftClass !== rightClass) return false;
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

export const branchValue = (
  alternatives: StaticValue[],
  reason: string,
  location: SourceLocation | null = null,
  preferredIndex = 0,
  predicate: string | null = null,
): StaticValue => {
  const flattened: StaticValue[] = [];
  let resolvedPreferred = 0;
  const add = (value: StaticValue): number => {
    const existing = flattened.findIndex((candidate) => isInterchangeable(candidate, value));
    if (existing !== -1) return existing;
    flattened.push(value);
    return flattened.length - 1;
  };
  alternatives.forEach((alternative, index) => {
    if (alternative.kind === "branch") {
      alternative.alternatives.forEach((inner, innerIndex) => {
        const position = add(inner);
        if (index === preferredIndex && innerIndex === alternative.preferredIndex) {
          resolvedPreferred = position;
        }
      });
    } else {
      const position = add(alternative);
      if (index === preferredIndex) resolvedPreferred = position;
    }
  });
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

export const isRenderableValue = (value: StaticValue): boolean =>
  value.kind === "element" ||
  value.kind === "list" ||
  value.kind === "repeat" ||
  value.kind === "primitive" ||
  value.kind === "unknown-primitive" ||
  value.kind === "branch" ||
  value.kind === "unknown";

/** Truthiness an unknown primitive's shape already decides: a clock reading or a range that excludes zero, a string with known characters or a known length. */
const getShapedTruthiness = (value: StaticUnknownPrimitiveValue): boolean | null => {
  if (value.clock) return true;
  const range = value.numberRange;
  if (range && (range.min > 0 || range.max < 0)) return true;
  const shape = value.stringShape;
  if (shape) {
    if (shape.prefix.length > 0) return true;
    if (shape.length !== null) return shape.length > 0;
  }
  return null;
};

export const getTruthiness = (value: StaticValue): boolean | null => {
  switch (value.kind) {
    case "primitive":
      return Boolean(value.value);
    case "branch": {
      const truthiness = getTruthiness(value.alternatives[0]);
      return value.alternatives.every((alternative) => getTruthiness(alternative) === truthiness)
        ? truthiness
        : null;
    }
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
export const toBooleanValue = (value: StaticValue): StaticValue =>
  mapValue(value, (alternative) => {
    const truthiness = getTruthiness(alternative);
    if (truthiness === null) {
      return unknownPrimitiveValue("boolean", `Boolean(${describeValue(alternative)})`);
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

export const isNullish = (value: StaticValue): boolean | null => {
  if (value.kind === "primitive") return value.value === null || value.value === undefined;
  if (value.kind === "unknown" || value.kind === "branch") return null;
  if (value.kind === "unknown-primitive") return value.primitiveType === "any" ? null : false;
  return false;
};

export const falsyCounterpart = (value: StaticValue): StaticValue => {
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
  transform: (alternative: StaticValue) => StaticValue,
): StaticValue => {
  if (value.kind !== "branch") return transform(value);
  return branchValue(
    value.alternatives.map(transform),
    value.reason,
    value.location,
    value.preferredIndex,
    value.predicate,
  );
};

const MAX_DISTRIBUTED_ALTERNATIVES = 16;

const countAlternatives = (value: StaticValue): number =>
  value.kind === "branch" ? value.alternatives.length : 1;

/** Applies a binary operation to every pair of alternatives while the product stays small; null when either operand is a branch too wide to distribute. */
export const distributeBinary = (
  left: StaticValue,
  right: StaticValue,
  operation: (leftAlternative: StaticValue, rightAlternative: StaticValue) => StaticValue,
): StaticValue | null => {
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

export const getStaticPrimitive = (value: StaticValue): StaticPrimitive | undefined =>
  value.kind === "primitive" ? value.value : undefined;

export const isIndefiniteItem = (item: StaticValue): boolean =>
  item.kind === "repeat" || item.kind === "optional";

export const getListLength = (list: StaticListValue): StaticValue =>
  list.items.some(isIndefiniteItem)
    ? unknownPrimitiveValue("number", "length of a partially known list")
    : primitiveValue(list.items.length);

/** Every item is present with certainty (it may still be a branch of values). */
export const hasDefiniteItems = (value: StaticValue): value is StaticListValue =>
  value.kind === "list" && !value.items.some(isIndefiniteItem);

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
    if (candidates.length > MAX_OPTIONAL_CANDIDATES) return false;
    const [head, ...rest] = remaining;
    if (head === undefined) {
      candidates.push(UNDEFINED_VALUE);
      return true;
    }
    if (head.kind === "repeat") return false;
    if (head.kind === "optional") {
      return head.isAbsentPreferred
        ? pick(rest, offset) && pick([head.value, ...rest], offset)
        : pick([head.value, ...rest], offset) && pick(rest, offset);
    }
    if (offset === 0) {
      candidates.push(head);
      return true;
    }
    return pick(rest, offset - 1);
  };
  if (!pick(items, index)) {
    return unknownValue(`index ${index} of a partially known list`, location);
  }
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

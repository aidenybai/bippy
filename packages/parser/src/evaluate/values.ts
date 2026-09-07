import { getCapturedExportReference, getOpaqueCaptureDescription } from "../observations.js";
import type {
  CapturedExportReference,
  CapturedValue,
  JsonValue,
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

/** A newly allocated array: `===` to no other value analysis constructs. */
export const listValue = (items: StaticValue[]): StaticListValue => ({
  kind: "list",
  items,
  allocation: Symbol(),
});

/** `Class.__proto__` / `Object.getPrototypeOf(Class)`: the parent class, or `Function.prototype` for a base class. */
export const getClassPrototype = (
  classValue: StaticClassValue,
  location: SourceLocation | null,
): StaticValue => classValue.body.superValue ?? unknownValue("Function.prototype", location);

/** A newly allocated object: `===` to no other value analysis constructs. */
export const objectValue = (entries: StaticObjectEntry[] = []): StaticObjectValue => ({
  kind: "object",
  entries,
  allocation: Symbol(),
});

export const objectFromRecord = (record: Record<string, StaticValue>): StaticObjectValue =>
  objectValue(Object.entries(record).map(([key, value]) => ({ kind: "property", key, value })));

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
  return null;
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

export const getObjectProperty = (object: StaticObjectValue, key: string): StaticValue => {
  for (let index = object.entries.length - 1; index >= 0; index--) {
    const entry = object.entries[index];
    if (entry.kind === "property") {
      if (entry.key === key) return entry.value;
      continue;
    }
    const spread = entry.value;
    if (spread.kind === "object") {
      const nested = getObjectProperty(spread, key);
      if (nested.kind !== "primitive" || nested.value !== undefined) return nested;
      continue;
    }
    if (spread.kind === "primitive" || spread.kind === "function" || spread.kind === "class")
      continue;
    if (spread.kind === "external" && spread.importedName === "*" && !spread.derived)
      return getExternalMember(spread, key);
    if (spread.kind === "branch") {
      let fromEarlier: StaticValue | null = null;
      return branchValue(
        spread.alternatives.map((alternative) => {
          const own = getObjectProperty(objectValue([{ kind: "spread", value: alternative }]), key);
          if (own.kind !== "primitive" || own.value !== undefined) return own;
          fromEarlier ??= getObjectProperty(objectValue(object.entries.slice(0, index)), key);
          return fromEarlier;
        }),
        spread.reason,
        spread.location,
        spread.preferredIndex,
      );
    }
    return unknownValue(`property "${key}" may come from a spread of ${describeValue(spread)}`);
  }
  if (key === "constructor" && object.constructedBy) return object.constructedBy;
  return UNDEFINED_VALUE;
};

/** Symbol-keyed properties are stored under an `@@` key; enumeration skips them like `Object.keys` does. */
export const getSymbolPropertyKey = (symbol: StaticSymbolValue): string => `@@${symbol.key}`;

export const isSymbolPropertyKey = (key: string): boolean => key.startsWith("@@");

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

/** The symbols keying own properties, as `Object.getOwnPropertySymbols` lists them. */
export const getKnownObjectSymbols = (object: StaticObjectValue): StaticSymbolValue[] | null =>
  getKnownOwnKeys(object, isSymbolPropertyKey)?.map((key) => ({
    kind: "symbol",
    key: key.slice("@@".length),
  })) ?? null;

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
        { kind: "spread", value: branchValue(alternatives, reason, location, preferredIndex) },
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

export const componentReference = (type: StaticElementType): StaticValue => ({
  kind: "component-reference",
  type,
});

const isSameValue = (left: StaticValue, right: StaticValue): boolean => {
  if (left === right) return true;
  if (left.kind === "primitive" && right.kind === "primitive") {
    return Object.is(left.value, right.value);
  }
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
  "host-node",
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

const isHeapValue = (value: StaticValue): value is StaticObjectValue | StaticListValue =>
  value.kind === "object" || value.kind === "list";

/** Two closures or classes created from different source nodes are never the same object. */
const isCallableValue = (value: StaticValue): value is StaticFunctionValue | StaticClassValue =>
  value.kind === "function" || value.kind === "class";

/**
 * `===` between two values, or null when analysis cannot decide. Import
 * bindings of the same external export are the same object; a primitive can
 * never be identical to a reference value.
 */
export const compareIdentity = (left: StaticValue, right: StaticValue): boolean | null => {
  if (left.kind === "primitive" && right.kind === "primitive") return left.value === right.value;
  if (left === right) return true;
  if (isHeapValue(left) && isHeapValue(right) && left.allocation && right.allocation) {
    return left.allocation === right.allocation;
  }
  if (left.kind === "symbol" && right.kind === "symbol") return left.key === right.key;
  if (left.kind === "global" && right.kind === "global" && left.name === right.name) return true;
  if (left.kind === "react-api" && right.kind === "react-api") return left.api === right.api;
  const hostTagName = (value: StaticValue): string | null =>
    value.kind === "component-reference" && value.type.kind === "host" ? value.type.tagName : null;
  if (hostTagName(left) !== null && hostTagName(right) !== null)
    return hostTagName(left) === hostTagName(right);
  if (hostTagName(left) !== null && right.kind === "primitive")
    return hostTagName(left) === right.value;
  if (hostTagName(right) !== null && left.kind === "primitive")
    return hostTagName(right) === left.value;
  if (left.kind === "external" && right.kind === "external" && !left.derived && !right.derived) {
    return left.packageName === right.packageName && left.importedName === right.importedName
      ? true
      : null;
  }
  if (isCallableValue(left) && isCallableValue(right) && left.node !== right.node) return false;
  const leftClass = getIdentityClass(left);
  const rightClass = getIdentityClass(right);
  if (leftClass && rightClass && leftClass !== rightClass) return false;
  return null;
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
  if (depth >= MAX_EQUIVALENCE_DEPTH) return true;
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
        (left.importedName === right.importedName || (left.derived && right.derived))
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

/** Alternatives analysis could never tell apart, so a branch keeps only one of them. */
const isInterchangeable = (left: StaticValue, right: StaticValue): boolean => {
  if (isSameValue(left, right)) return true;
  if (left.kind === "unknown" && right.kind === "unknown") {
    if (left.thrown === undefined || right.thrown === undefined)
      return left.thrown === right.thrown;
    return isInterchangeable(left.thrown, right.thrown);
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
  return {
    kind: "branch",
    alternatives: flattened,
    preferredIndex: resolvedPreferred,
    reason,
    location,
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

export const getTruthiness = (value: StaticValue): boolean | null => {
  switch (value.kind) {
    case "primitive":
      return Boolean(value.value);
    case "unknown-primitive":
    case "unknown":
    case "branch":
    case "optional":
      return null;
    case "external":
      return value.derived ? null : true;
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
    case "host-node":
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
  );
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
): StaticOptionalValue => ({ kind: "optional", value, reason, location });

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
      item.kind === "repeat" ? item : optionalValue(item, value.reason, value.location),
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
      return [optionalValue(item, value.reason, value.location)];
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
    if (head.kind === "optional") return pick([head.value, ...rest], offset) && pick(rest, offset);
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
    case "host-node":
      return `<${value.tagName}> node`;
    case "method":
      return `${describeNested(value.receiver)}.${value.name}`;
    case "native-function":
      return `native ${value.name}`;
    case "native-object":
      return `native ${value.value.constructor.name}`;
    case "proxy":
      return `proxy of ${describeNested(value.target)}`;
    case "unknown":
      return depth === 0 ? `unknown(${value.reason})` : "unknown";
  }
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
      return type.stub.displayName ?? "anonymous stub";
    case "unknown":
      return type.displayName ?? "unknown";
  }
};

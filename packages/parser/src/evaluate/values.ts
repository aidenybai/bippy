import type {
  SourceLocation,
  StaticBranchValue,
  StaticElementType,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticOptionalValue,
  StaticPrimitive,
  StaticPrimitiveValue,
  StaticUnknownPrimitiveValue,
  StaticUnknownValue,
  StaticValue,
  UnknownPrimitiveType,
} from "../types.js";
import { getExternalMember } from "../react/react-api.js";

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

export const unknownPrimitiveValue = (
  primitiveType: UnknownPrimitiveType,
  reason: string,
): StaticUnknownPrimitiveValue => ({ kind: "unknown-primitive", primitiveType, reason });

export const listValue = (items: StaticValue[]): StaticListValue => ({ kind: "list", items });

export const objectValue = (entries: StaticObjectEntry[] = []): StaticObjectValue => ({
  kind: "object",
  entries,
});

export const objectFromRecord = (record: Record<string, StaticValue>): StaticObjectValue =>
  objectValue(Object.entries(record).map(([key, value]) => ({ kind: "property", key, value })));

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
      return branchValue(
        spread.alternatives.map((alternative) =>
          getObjectProperty(objectValue([{ kind: "spread", value: alternative }]), key),
        ),
        spread.reason,
        spread.location,
        spread.preferredIndex,
      );
    }
    return unknownValue(`property "${key}" may come from a spread of ${describeValue(spread)}`);
  }
  return UNDEFINED_VALUE;
};

export const getKnownObjectKeys = (object: StaticObjectValue): string[] | null => {
  const keys: string[] = [];
  for (const entry of object.entries) {
    if (entry.kind === "property") {
      if (!keys.includes(entry.key)) keys.push(entry.key);
      continue;
    }
    if (entry.value.kind === "object") {
      const nested = getKnownObjectKeys(entry.value);
      if (!nested) return null;
      for (const key of nested) if (!keys.includes(key)) keys.push(key);
      continue;
    }
    if (entry.value.kind === "primitive") continue;
    return null;
  }
  return keys;
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

/**
 * `===` between two values, or null when analysis cannot decide. Import
 * bindings of the same external export are the same object; a primitive can
 * never be identical to a reference value.
 */
export const compareIdentity = (left: StaticValue, right: StaticValue): boolean | null => {
  if (left.kind === "primitive" && right.kind === "primitive") return left.value === right.value;
  if (left === right) return true;
  if (left.kind === "symbol" && right.kind === "symbol") return left.key === right.key;
  if (left.kind === "external" && right.kind === "external" && !left.derived && !right.derived) {
    return left.packageName === right.packageName && left.importedName === right.importedName
      ? true
      : null;
  }
  const isScalar = (value: StaticValue): boolean =>
    value.kind === "primitive" || value.kind === "symbol";
  if (
    (isScalar(left) && REFERENCE_KINDS.has(right.kind)) ||
    (isScalar(right) && REFERENCE_KINDS.has(left.kind))
  ) {
    return false;
  }
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

export const branchValue = (
  alternatives: StaticValue[],
  reason: string,
  location: SourceLocation | null = null,
  preferredIndex = 0,
): StaticValue => {
  const flattened: StaticValue[] = [];
  let resolvedPreferred = 0;
  alternatives.forEach((alternative, index) => {
    const startIndex = flattened.length;
    if (alternative.kind === "branch") {
      for (const inner of alternative.alternatives) {
        if (!flattened.some((existing) => isSameValue(existing, inner))) flattened.push(inner);
      }
    } else if (!flattened.some((existing) => isSameValue(existing, alternative))) {
      flattened.push(alternative);
    }
    if (index === preferredIndex) {
      resolvedPreferred = Math.min(startIndex, flattened.length - 1);
    }
  });
  if (flattened.length === 1) return flattened[0];
  const branch: StaticBranchValue = {
    kind: "branch",
    alternatives: flattened,
    preferredIndex: Math.max(0, resolvedPreferred),
    reason,
    location,
  };
  return branch;
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
    case "proxy":
      return true;
  }
};

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

export const describeValue = (value: StaticValue): string => {
  switch (value.kind) {
    case "primitive":
      return typeof value.value === "string" ? JSON.stringify(value.value) : String(value.value);
    case "unknown-primitive":
      return `<${value.primitiveType}>`;
    case "element":
      return `<${describeElementType(value.type)}>`;
    case "list":
      return `[${value.items.map(describeValue).join(", ")}]`;
    case "repeat":
      return `repeat(${describeValue(value.item)})`;
    case "branch":
      return `branch(${value.alternatives.map(describeValue).join(" | ")})`;
    case "optional":
      return `optional(${describeValue(value.value)})`;
    case "regexp":
      return `/${value.pattern}/${value.flags}`;
    case "symbol":
      return `Symbol.for(${JSON.stringify(value.key)})`;
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
      return `${describeValue(value.receiver)}.${value.name}`;
    case "native-function":
      return `native ${value.name}`;
    case "proxy":
      return `proxy of ${describeValue(value.target)}`;
    case "unknown":
      return `unknown(${value.reason})`;
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

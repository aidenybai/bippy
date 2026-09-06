import type {
  SourceLocation,
  StaticBranchValue,
  StaticElementType,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticPrimitive,
  StaticPrimitiveValue,
  StaticUnknownPrimitiveValue,
  StaticUnknownValue,
  StaticValue,
  UnknownPrimitiveType,
} from "../types.js";

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
      return null;
    case "element":
    case "list":
    case "repeat":
    case "object":
    case "function":
    case "class":
    case "component-reference":
    case "context":
    case "react-api":
    case "external":
    case "namespace":
    case "global":
    case "method":
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

export const getListLength = (list: StaticListValue): StaticValue => {
  const hasUnknownLength = list.items.some(
    (item) => item.kind === "repeat" || item.kind === "unknown",
  );
  return hasUnknownLength
    ? unknownPrimitiveValue("number", "length of a partially known list")
    : primitiveValue(list.items.length);
};

export const isKnownList = (value: StaticValue): value is StaticListValue =>
  value.kind === "list" &&
  value.items.every(
    (item) => item.kind !== "unknown" && item.kind !== "repeat" && item.kind !== "branch",
  );

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
      return `${describeValue(value.receiver)}.${value.name}`;
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
    case "unknown":
      return type.displayName ?? "unknown";
  }
};

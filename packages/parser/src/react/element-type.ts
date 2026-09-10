import type {
  ComponentDefinition,
  StaticElementType,
  StaticObjectEntry,
  StaticValue,
} from "../types.js";
import {
  getObjectProperty,
  isUndefinedValue,
  mapValue,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
} from "../evaluate/values.js";

export interface SplitElementProps {
  entries: StaticObjectEntry[];
  key: StaticValue | null;
}

/**
 * `key` the way `jsx(type, config, maybeKey)` and `createElement(type, config)`
 * read it: a defined `config.key` (the last one in source order, written directly
 * or carried by a spread) wins, else `maybeKey`, and it is not passed on as a prop.
 */
export const splitElementKey = (
  entries: StaticObjectEntry[],
  maybeKey: StaticValue = UNDEFINED_VALUE,
): SplitElementProps => {
  const key = mapValue(getObjectProperty(objectValue(entries), "key"), (configKey) =>
    isUndefinedValue(configKey) ? maybeKey : configKey,
  );
  return {
    entries: entries.filter((entry) => entry.kind !== "property" || entry.key !== "key"),
    key: isUndefinedValue(key) ? null : key,
  };
};

export const toElementKey = (key: StaticValue | null): StaticValue | null => {
  if (key?.kind !== "primitive") return key;
  if (key.value === undefined) return null;
  return primitiveValue(String(key.value));
};

export const createFunctionComponentDefinition = (
  value: Extract<StaticValue, { kind: "function" }>,
): ComponentDefinition => ({
  name: value.name,
  module: value.module,
  node: value.node,
  scope: value.scope,
  classBody: null,
  properties: value.properties,
  staticGetters: new Map(),
  boundArgs: value.boundArgs,
  boundThis: value.boundThis,
  isClientReference: value.isClientReference ?? false,
});

const createClassComponentDefinition = (
  value: Extract<StaticValue, { kind: "class" }>,
): ComponentDefinition => ({
  name: value.name,
  module: value.module,
  node: value.node,
  scope: value.scope,
  classBody: value.body,
  properties: value.properties,
  staticGetters: value.staticGetters,
  isClientReference: value.isClientReference ?? false,
});

const toClientReferenceType = (type: StaticElementType): StaticElementType => {
  switch (type.kind) {
    case "function":
    case "class":
    case "forward-ref":
      return { ...type, component: { ...type.component, isClientReference: true } };
    case "memo":
      return { ...type, inner: toClientReferenceType(type.inner) };
    case "lazy":
      return type.inner ? { ...type, inner: toClientReferenceType(type.inner) } : type;
    default:
      return type;
  }
};

/** The value as server code sees it once imported through a `"use client"` module. */
export const toClientReference = (value: StaticValue): StaticValue => {
  switch (value.kind) {
    case "function":
    case "class":
      return { ...value, isClientReference: true };
    case "component-reference":
      return { kind: "component-reference", type: toClientReferenceType(value.type) };
    default:
      return value;
  }
};

export const toElementType = (value: StaticValue, nameHint: string | null): StaticElementType => {
  switch (value.kind) {
    case "primitive":
      if (typeof value.value === "string") return { kind: "host", tagName: value.value };
      return {
        kind: "unknown",
        displayName: nameHint,
        reason: `element type is ${String(value.value)}`,
      };
    case "function":
      return { kind: "function", component: createFunctionComponentDefinition(value) };
    case "class":
      return { kind: "class", component: createClassComponentDefinition(value) };
    case "component-reference":
      return value.type;
    case "context":
      return {
        kind: "context-provider",
        context: value.context,
        displayName: value.context.displayName,
      };
    case "react-api":
      switch (value.api) {
        case "Fragment":
          return { kind: "fragment" };
        case "StrictMode":
          return { kind: "strict-mode" };
        case "Suspense":
          return { kind: "suspense" };
        case "SuspenseList":
          return { kind: "suspense-list" };
        case "Profiler":
          return { kind: "profiler" };
        case "Activity":
          return { kind: "activity" };
        case "ViewTransition":
          return { kind: "view-transition" };
        default:
          return {
            kind: "unknown",
            displayName: nameHint,
            reason: `React.${value.api} is not an element type`,
          };
      }
    case "external":
      return {
        kind: "external",
        packageName: value.packageName,
        importedName: value.importedName,
        displayName: nameHint ?? value.importedName.split(".").pop() ?? value.importedName,
      };
    case "branch":
      return { kind: "unknown", displayName: nameHint, reason: "element type depends on a branch" };
    case "unknown":
      return { kind: "unknown", displayName: nameHint, reason: value.reason };
    case "unknown-primitive":
      return {
        kind: "unknown",
        displayName: nameHint,
        reason: `dynamic ${value.primitiveType} element type`,
      };
    case "element":
    case "list":
    case "repeat":
    case "optional":
    case "object":
    case "regexp":
    case "symbol":
    case "namespace":
    case "global":
    case "method":
    case "native-function":
    case "native-object":
    case "proxy":
      return {
        kind: "unknown",
        displayName: nameHint,
        reason: `invalid element type (${value.kind})`,
      };
  }
};

export const getFunctionComponent = (type: StaticElementType): ComponentDefinition | null => {
  switch (type.kind) {
    case "function":
    case "forward-ref":
      return type.component;
    case "memo":
      return getFunctionComponent(type.inner);
    default:
      return null;
  }
};

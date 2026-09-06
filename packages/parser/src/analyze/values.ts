import type { Class, Span } from "@oxc-project/types";
import type { StaticFiber } from "../fiber/types.js";
import type { FunctionLike } from "../module/ast.js";
import type { SourceLocation } from "../module/location.js";
import type { ParsedModule } from "../module/types.js";
import type { Scope } from "./scope.js";

export type Primitive = string | number | boolean | bigint | null | undefined;

/** A fully known primitive. */
export interface LiteralValue {
  kind: "literal";
  value: Primitive;
}

/** A string whose contents are only known at runtime (template literal, `t()`). */
export interface TextValue {
  kind: "text";
  description: string;
}

export interface UnknownValue {
  kind: "unknown";
  description: string;
}

export interface ArrayValue {
  kind: "array";
  items: StaticValue[];
  /** Undecided control-flow depth the array was created at; mutations from deeper are conditional. */
  depth: number;
}

/** Zero or more repetitions of `item`, the shape produced by `.map()`. */
export interface ListValue {
  kind: "list";
  item: StaticValue;
  description: string;
  /** `flatMap()` output: an array item contributes its elements, not a fragment. */
  isFlat: boolean;
  /** Spread into an enclosing array (`[a, ...items.map(…)]`), so items are siblings of `a`. */
  isInline: boolean;
}

export interface ConditionalValue {
  kind: "conditional";
  test: string;
  whenTrue: StaticValue;
  whenFalse: StaticValue;
}

export interface ObjectValue {
  kind: "object";
  properties: Map<string, StaticValue>;
  /** An unknown object was spread in, so absent keys may still exist. */
  hasUnknownSpread: boolean;
  /** Undecided control-flow depth the object was created at; mutations from deeper are conditional. */
  depth: number;
}

/** A closure: the function together with the scope it was created in. */
export interface FunctionValue {
  kind: "function";
  fn: FunctionLike;
  module: ParsedModule;
  scope: Scope;
  /** `this` captured for class methods; `null` for plain functions. */
  thisValue: StaticValue | null;
  /** Inferred name for display, e.g. `renderHeader` for `const renderHeader = () => …`. */
  name: string | null;
}

export interface ComponentValue {
  kind: "component";
  definition: ComponentDefinition;
}

export interface ElementValue {
  kind: "element";
  type: StaticValue;
  key: StaticValue | null;
  props: ObjectValue;
  location: SourceLocation | null;
  /** Fiber whose render produced this element; `null` at the root. */
  owner: StaticFiber | null;
}

/** The exports of a parsed module, as produced by `import * as ns` or `import()`. */
export interface NamespaceValue {
  kind: "namespace";
  module: ParsedModule;
}

/** A binding imported from a package outside the analyzed graph. */
export interface ExternalValue {
  kind: "external";
  specifier: string;
  packageName: string | null;
  /** `default`, `*` or the exported name imported from the package. */
  importedName: string;
  memberPath: string[];
  /** Best display name: the local import name followed by accessed members. */
  name: string | null;
}

export type StaticValue =
  | LiteralValue
  | TextValue
  | UnknownValue
  | ArrayValue
  | ListValue
  | ConditionalValue
  | ObjectValue
  | FunctionValue
  | ComponentValue
  | ElementValue
  | NamespaceValue
  | ExternalValue;

export type BuiltinComponentName =
  | "Fragment"
  | "Suspense"
  | "SuspenseList"
  | "StrictMode"
  | "Profiler"
  | "Activity"
  | "ViewTransition"
  | "Portal";

export interface ClassComponentDefinition {
  kind: "class";
  name: string | null;
  module: ParsedModule;
  classNode: Class;
  scope: Scope;
  isErrorBoundary: boolean;
  span: Span;
}

export interface MemoComponentDefinition {
  kind: "memo";
  name: string | null;
  inner: StaticValue;
  hasCompare: boolean;
  span: Span;
}

export interface ForwardRefComponentDefinition {
  kind: "forwardRef";
  name: string | null;
  render: FunctionValue | null;
  span: Span;
}

export interface LazyComponentDefinition {
  kind: "lazy";
  name: string | null;
  inner: StaticValue;
  span: Span;
}

export interface ContextDefinition {
  kind: "context";
  name: string | null;
  role: "provider" | "consumer";
  defaultValue: StaticValue;
  /** Module and span of the `createContext` call; together they identify the context. */
  module: ParsedModule;
  span: Span;
}

export interface BuiltinComponentDefinition {
  kind: "builtin";
  name: BuiltinComponentName;
}

export type ComponentDefinition =
  | ClassComponentDefinition
  | MemoComponentDefinition
  | ForwardRefComponentDefinition
  | LazyComponentDefinition
  | ContextDefinition
  | BuiltinComponentDefinition;

export const literal = (value: Primitive): LiteralValue => ({ kind: "literal", value });
export const text = (description: string): TextValue => ({ kind: "text", description });
export const unknown = (description: string): UnknownValue => ({ kind: "unknown", description });
export const array = (items: StaticValue[], depth = 0): ArrayValue => ({ kind: "array", items, depth });
export const list = (item: StaticValue, description: string, isFlat = false): ListValue => ({
  kind: "list",
  item,
  description,
  isFlat,
  isInline: false,
});
export const conditional = (
  test: string,
  whenTrue: StaticValue,
  whenFalse: StaticValue,
): ConditionalValue => ({ kind: "conditional", test, whenTrue, whenFalse });
export const object = (
  properties: Iterable<[string, StaticValue]> = [],
  hasUnknownSpread = false,
  depth = 0,
): ObjectValue => ({ kind: "object", properties: new Map(properties), hasUnknownSpread, depth });
export const component = (definition: ComponentDefinition): ComponentValue => ({
  kind: "component",
  definition,
});
export const builtin = (name: BuiltinComponentName): ComponentValue =>
  component({ kind: "builtin", name });

export const UNDEFINED = literal(undefined);
export const NULL = literal(null);
export const TRUE = literal(true);
export const FALSE = literal(false);

export const isRenderedAsText = (value: Primitive): boolean =>
  (typeof value === "string" && value !== "") ||
  typeof value === "number" ||
  typeof value === "bigint";

export const getObjectProperty = (value: ObjectValue, key: string): StaticValue =>
  value.properties.get(key) ??
  (value.hasUnknownSpread ? unknown(`spread property "${key}"`) : UNDEFINED);

export const mergeObjects = (target: ObjectValue, source: ObjectValue): void => {
  for (const [key, propertyValue] of source.properties) target.properties.set(key, propertyValue);
  if (source.hasUnknownSpread) target.hasUnknownSpread = true;
};

export const cloneObject = (value: ObjectValue): ObjectValue =>
  object(value.properties, value.hasUnknownSpread);

/**
 * Applies the name a value is bound to, mirroring the runtime's
 * `Function.name` inference: `const Header = () => …` names the arrow, but
 * `const Header = memo(() => …)` leaves the inner function anonymous.
 * Contexts are named for display; the runtime has no name for them either way.
 */
export const nameValue = (value: StaticValue, name: string | null): StaticValue => {
  if (name === null) return value;
  if (value.kind === "function") return value.name === null ? { ...value, name } : value;
  if (value.kind !== "component") return value;
  const definition = value.definition;
  const isNameable = definition.kind === "class" || definition.kind === "context";
  return isNameable && definition.name === null ? component({ ...definition, name }) : value;
};

/** `Component.displayName = "…"`, which the runtime prefers over `Function.name`. */
export const withDisplayName = (value: StaticValue, displayName: string): StaticValue => {
  if (value.kind === "function") return { ...value, name: displayName };
  if (value.kind === "component" && value.definition.kind !== "builtin") {
    return component({ ...value.definition, name: displayName });
  }
  return value;
};

/** Truthiness when statically decidable, otherwise `null`. */
export const getTruthiness = (value: StaticValue): boolean | null => {
  switch (value.kind) {
    case "literal":
      return Boolean(value.value);
    case "array":
    case "object":
    case "function":
    case "component":
    case "element":
    case "list":
    case "namespace":
    case "external":
      return true;
    case "text":
    case "unknown":
      return null;
    case "conditional": {
      const whenTrue = getTruthiness(value.whenTrue);
      const whenFalse = getTruthiness(value.whenFalse);
      return whenTrue !== null && whenTrue === whenFalse ? whenTrue : null;
    }
  }
};

export const getComponentName = (definition: ComponentDefinition): string | null => {
  switch (definition.kind) {
    case "builtin":
      return definition.name;
    case "memo":
      return definition.name ?? getValueName(definition.inner);
    case "lazy":
      return definition.name ?? getValueName(definition.inner);
    case "forwardRef":
      return definition.name ?? definition.render?.name ?? null;
    default:
      return definition.name;
  }
};

/** Name a value would be displayed with when used as an element type. */
export const getValueName = (value: StaticValue): string | null => {
  switch (value.kind) {
    case "literal":
      return typeof value.value === "string" ? value.value : null;
    case "function":
      return value.name;
    case "component":
      return getComponentName(value.definition);
    case "external":
      return value.name;
    default:
      return null;
  }
};

export const describeValue = (value: StaticValue): string => {
  switch (value.kind) {
    case "literal":
      return typeof value.value === "string" ? JSON.stringify(value.value) : String(value.value);
    case "text":
      return `text(${value.description})`;
    case "unknown":
      return `unknown(${value.description})`;
    case "array":
      return `[${value.items.map(describeValue).join(", ")}]`;
    case "list":
      return `list(${value.description})`;
    case "conditional":
      return `(${value.test} ? ${describeValue(value.whenTrue)} : ${describeValue(value.whenFalse)})`;
    case "object":
      return `{${[...value.properties.keys()].join(", ")}${value.hasUnknownSpread ? ", ..." : ""}}`;
    case "function":
      return `fn(${value.name ?? "anonymous"})`;
    case "component":
      return `component(${getComponentName(value.definition) ?? value.definition.kind})`;
    case "element":
      return `<${getValueName(value.type) ?? describeValue(value.type)}>`;
    case "namespace":
      return `namespace(${value.module.filePath})`;
    case "external":
      return `external(${value.specifier}:${[value.importedName, ...value.memberPath].join(".")})`;
  }
};

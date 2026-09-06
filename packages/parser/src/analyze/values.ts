import type { Class, Span } from "@oxc-project/types";
import type { StaticFiber } from "../fiber/types.js";
import type { FunctionLike } from "../module/ast.js";
import type { SourceLocation } from "../module/location.js";
import type { ParsedModule } from "../module/types.js";
import type { Scope } from "./scope.js";

export type Primitive = string | number | boolean | bigint | symbol | null | undefined;

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

/** A regular expression literal; matching is stateless, `lastIndex` is not tracked. */
export interface RegExpValue {
  kind: "regexp";
  pattern: string;
  flags: string;
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

/**
 * An array item that is present only when `test` passes at runtime: what
 * `.filter()` keeps when its predicate cannot be decided. Unlike a
 * conditional with an `undefined` arm, callbacks over the array never see
 * the absent case and the array's length and indices become unknown.
 */
export interface OptionalValue {
  kind: "optional";
  test: string;
  value: StaticValue;
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
  /** Properties assigned on the function object itself (`Card.Header = Header`). */
  statics: Map<string, StaticValue>;
}

export interface ComponentValue {
  kind: "component";
  definition: ComponentDefinition;
  /** Properties assigned on the component object itself (`Sidebar.Tabs = Tabs`). */
  statics: Map<string, StaticValue>;
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
  | RegExpValue
  | ArrayValue
  | ListValue
  | ConditionalValue
  | OptionalValue
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
  /** Project-local class component this one extends and inherits members from. */
  base: ClassComponentDefinition | null;
  /** `static defaultProps`, resolved into props the way `createElement` does for classes. */
  defaultProps: ObjectValue | null;
  /** `static contextType`, read into `this.context`. */
  contextType: StaticValue | null;
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
export const regexp = (pattern: string, flags: string): RegExpValue => ({
  kind: "regexp",
  pattern,
  flags,
});
/** A fresh `RegExp` for one match, so shared values never observe each other's `lastIndex`. */
export const toRegExp = (value: RegExpValue): RegExp => new RegExp(value.pattern, value.flags);
export const array = (items: StaticValue[], depth = 0): ArrayValue => ({
  kind: "array",
  items,
  depth,
});
export const list = (item: StaticValue, description: string, isFlat = false): ListValue => ({
  kind: "list",
  item,
  description,
  isFlat,
  isInline: false,
});
/** Rewrites `value` knowing that `test` evaluated to `outcome` on this path. */
const assumeTest = (value: StaticValue, test: string, outcome: boolean): StaticValue => {
  if (value.kind !== "conditional") return value;
  if (value.test === test)
    return assumeTest(outcome ? value.whenTrue : value.whenFalse, test, outcome);
  const whenTrue = assumeTest(value.whenTrue, test, outcome);
  const whenFalse = assumeTest(value.whenFalse, test, outcome);
  return whenTrue === value.whenTrue && whenFalse === value.whenFalse
    ? value
    : { ...value, whenTrue, whenFalse };
};

const isSameLiteral = (left: StaticValue, right: StaticValue): boolean =>
  left.kind === "literal" && right.kind === "literal" && Object.is(left.value, right.value);

/**
 * A value that depends on `test`. Within a render the same test expression
 * has one outcome, so nested conditionals on it collapse; identical arms
 * collapse to the value itself.
 */
export const conditional = (
  test: string,
  whenTrue: StaticValue,
  whenFalse: StaticValue,
): StaticValue => {
  const assumedTrue = assumeTest(whenTrue, test, true);
  const assumedFalse = assumeTest(whenFalse, test, false);
  if (assumedTrue === assumedFalse || isSameLiteral(assumedTrue, assumedFalse)) return assumedTrue;
  return { kind: "conditional", test, whenTrue: assumedTrue, whenFalse: assumedFalse };
};
/** Nested optionals are one item that needs every test to pass. */
export const optional = (test: string, value: StaticValue): OptionalValue =>
  value.kind === "optional"
    ? { kind: "optional", test: `${value.test} && ${test}`, value: value.value }
    : { kind: "optional", test, value };
/** An optional item read on its own, e.g. as a spread argument: it is `undefined` when absent. */
export const readItem = (value: StaticValue): StaticValue =>
  value.kind === "optional" ? conditional(value.test, value.value, UNDEFINED) : value;

/** Beyond this many undecided items, selecting one is not worth the branching. */
export const SELECTION_LIMIT = 8;

/**
 * The item at `position` once absent items are skipped, so `filtered[0]`
 * reads as the first item that is present. Each optional item before the
 * position contributes one branch on its presence test.
 */
export const selectItem = (items: StaticValue[], position: number): StaticValue => {
  const firstOptional = items.findIndex((item) => item.kind === "optional");
  if (firstOptional === -1 || firstOptional > position) return items[position] ?? UNDEFINED;
  if (items.length > SELECTION_LIMIT) return unknown(`array[${position}]`);
  const select = (start: number, remaining: number): StaticValue => {
    const item = items[start];
    if (item === undefined) return UNDEFINED;
    if (item.kind !== "optional") {
      return remaining === 0 ? item : select(start + 1, remaining - 1);
    }
    return conditional(
      item.test,
      remaining === 0 ? item.value : select(start + 1, remaining - 1),
      select(start + 1, remaining),
    );
  };
  return select(0, position);
};
export const object = (
  properties: Iterable<[string, StaticValue]> = [],
  hasUnknownSpread = false,
  depth = 0,
): ObjectValue => ({ kind: "object", properties: new Map(properties), hasUnknownSpread, depth });
export const component = (
  definition: ComponentDefinition,
  statics: Map<string, StaticValue> = new Map(),
): ComponentValue => ({
  kind: "component",
  definition,
  statics,
});
export const builtin = (name: BuiltinComponentName): ComponentValue =>
  component({ kind: "builtin", name });

export const UNDEFINED = literal(undefined);
export const NULL = literal(null);
export const TRUE = literal(true);
export const FALSE = literal(false);

export const isNullish = (value: Primitive): value is null | undefined =>
  value === null || value === undefined;

export const isNullishValue = (value: StaticValue): boolean =>
  value.kind === "literal" && isNullish(value.value);

/** Applies `transform` to every arm of a conditional, keeping its branch structure. */
export const mapConditional = (
  value: StaticValue,
  transform: (arm: StaticValue) => StaticValue,
): StaticValue =>
  value.kind === "conditional"
    ? conditional(
        value.test,
        mapConditional(value.whenTrue, transform),
        mapConditional(value.whenFalse, transform),
      )
    : transform(value);

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
 * `const Header = memo(() => …)` or `const Header = parts.header` leaves the
 * function as it was, so `isDefinition` says whether the binding's
 * initializer was the anonymous function or class itself. Contexts are
 * named for display; the runtime has no name for them either way.
 */
export const nameValue = (
  value: StaticValue,
  name: string | null,
  isDefinition: boolean,
): StaticValue => {
  if (name === null) return value;
  if (value.kind === "function") {
    return isDefinition && value.name === null ? { ...value, name } : value;
  }
  if (value.kind !== "component") return value;
  const definition = value.definition;
  const isNameable =
    definition.kind === "context" || (definition.kind === "class" && isDefinition);
  return isNameable && definition.name === null
    ? component({ ...definition, name }, value.statics)
    : value;
};

/** `Component.displayName = "…"`, which the runtime prefers over `Function.name`. */
export const withDisplayName = (value: StaticValue, displayName: string): StaticValue => {
  if (value.kind === "function") return { ...value, name: displayName };
  if (value.kind === "component" && value.definition.kind !== "builtin") {
    return component({ ...value.definition, name: displayName }, value.statics);
  }
  return value;
};

/**
 * `Target.key = value` on a function or component, as written for compound
 * components and static config. `displayName` is folded into the name the
 * way the runtime prefers it.
 */
export const assignStatic = (target: StaticValue, key: string, value: StaticValue): void => {
  if (target.kind !== "function" && target.kind !== "component") return;
  if (key === "displayName" || (key === "name" && target.kind === "function")) {
    if (value.kind !== "literal" || typeof value.value !== "string") return;
    if (target.kind === "function") target.name = value.value || null;
    else if (target.definition.kind !== "builtin") target.definition.name = value.value;
    return;
  }
  target.statics.set(key, value);
};

const isFullyKnownInner = (value: StaticValue, visited: Set<StaticValue>): boolean => {
  switch (value.kind) {
    case "literal":
    case "regexp":
    case "function":
    case "component":
    case "namespace":
    case "external":
      return true;
    case "text":
    case "unknown":
    case "list":
    case "conditional":
    case "optional":
      return false;
    case "array":
      if (visited.has(value)) return true;
      visited.add(value);
      return value.items.every((item) => isFullyKnownInner(item, visited));
    case "object":
      if (visited.has(value)) return true;
      visited.add(value);
      return (
        !value.hasUnknownSpread &&
        [...value.properties.values()].every((property) => isFullyKnownInner(property, visited))
      );
    case "element":
      return (
        isFullyKnownInner(value.type, visited) &&
        (value.key === null || isFullyKnownInner(value.key, visited)) &&
        isFullyKnownInner(value.props, visited)
      );
  }
};

/**
 * Whether no part of `value` stands in for a runtime value. Computation on
 * fully known input can be followed to its result; anything else can only be
 * approximated.
 */
export const isFullyKnown = (value: StaticValue): boolean => isFullyKnownInner(value, new Set());

/** Truthiness when statically decidable, otherwise `null`. */
export const getTruthiness = (value: StaticValue): boolean | null => {
  switch (value.kind) {
    case "literal":
      return Boolean(value.value);
    case "regexp":
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
    case "optional":
      return getTruthiness(value.value) === false ? false : null;
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
    case "regexp":
      return `/${value.pattern}/${value.flags}`;
    case "array":
      return `[${value.items.map(describeValue).join(", ")}]`;
    case "list":
      return `list(${value.description})`;
    case "conditional":
      return `(${value.test} ? ${describeValue(value.whenTrue)} : ${describeValue(value.whenFalse)})`;
    case "optional":
      return `(${value.test} ? ${describeValue(value.value)} : absent)`;
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

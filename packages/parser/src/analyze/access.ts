import { getReactApiReference } from "../link/react-api.js";
import { getGlobalMember } from "./globals.js";
import type { Interpreter } from "./interpreter.js";
import {
  type ArrayValue,
  builtin,
  type BuiltinComponentName,
  type ClassComponentDefinition,
  type ComponentDefinition,
  type ComponentValue,
  component,
  conditional,
  describeValue,
  type ExternalValue,
  getObjectProperty,
  list,
  literal,
  NULL,
  optional,
  readItem,
  selectItem,
  type StaticValue,
  UNDEFINED,
  unknown,
} from "./values.js";

const BUILTIN_COMPONENT_BY_API: Record<string, BuiltinComponentName> = {
  Fragment: "Fragment",
  Suspense: "Suspense",
  SuspenseList: "SuspenseList",
  unstable_SuspenseList: "SuspenseList",
  StrictMode: "StrictMode",
  Profiler: "Profiler",
  Activity: "Activity",
  unstable_Activity: "Activity",
  ViewTransition: "ViewTransition",
  unstable_ViewTransition: "ViewTransition",
};

/**
 * Turns references to React's built-in component types into component
 * values; every other external reference stays opaque.
 */
export const normalizeExternal = (value: ExternalValue): StaticValue => {
  const reference = getReactApiReference(value);
  if (!reference || reference.source === "react-dom") return value;
  const builtinName = BUILTIN_COMPONENT_BY_API[reference.api];
  return builtinName ? builtin(builtinName) : value;
};

const accessExternalMember = (value: ExternalValue, member: string): StaticValue =>
  normalizeExternal({
    ...value,
    memberPath: [...value.memberPath, member],
    name: value.name ? `${value.name}.${member}` : member,
  });

/** Fields of an element object (`ReactJSXElement.js`), and those development builds add. */
const ELEMENT_KEYS = new Set(["$$typeof", "type", "key", "ref", "props"]);
const ELEMENT_DEVELOPMENT_KEYS = new Set([
  "_owner",
  "_store",
  "_debugInfo",
  "_debugStack",
  "_debugTask",
]);

/** Fields of the wrapper objects React's `memo`, `forwardRef`, `lazy` and `createContext` return. */
const DEFINITION_KEYS: Partial<Record<ComponentDefinition["kind"], string[]>> = {
  memo: ["$$typeof", "type", "compare"],
  forwardRef: ["$$typeof", "render"],
  lazy: ["$$typeof", "_payload", "_init"],
  context: ["$$typeof", "Provider", "Consumer", "_currentValue", "_currentValue2", "_threadCount"],
};

const hasStaticMember = (definition: ClassComponentDefinition, key: string): boolean =>
  definition.members.some((member) => member.isStatic && member.key === key) ||
  (definition.base !== null && hasStaticMember(definition.base, key));

/** Has `lastIndex`, an own property of every regular expression, along with the prototype. */
const REGEXP_INSTANCE = /./;

/** The array index a property key denotes, or `null` for any other key. */
export const getIndex = (key: string): number | null => {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && String(index) === key ? index : null;
};

/** `key in value`, when the value's shape decides it; `null` otherwise. */
export const hasProperty = (value: StaticValue, key: string): boolean | null => {
  switch (value.kind) {
    case "object":
      if (value.properties.has(key) || key in Object.prototype) return true;
      return value.hasUnknownSpread ? null : false;
    case "array": {
      if (value.properties.has(key) || key in Array.prototype) return true;
      const index = getIndex(key);
      if (index === null) return false;
      const firstOptional = value.items.findIndex((item) => item.kind === "optional");
      if (firstOptional === -1) return index < value.items.length;
      return index < firstOptional ? true : null;
    }
    case "literal":
      return value.value === null || value.value === undefined ? null : key in Object(value.value);
    case "element":
      if (ELEMENT_KEYS.has(key) || key in Object.prototype) return true;
      return ELEMENT_DEVELOPMENT_KEYS.has(key) ? null : false;
    case "function":
      if (value.statics.has(key) || key in Function.prototype) return true;
      /** Only arrow functions lack one, and the value does not tell them apart. */
      return value.hasUnknownStatics || key === "prototype" ? null : false;
    case "component": {
      if (value.statics.has(key)) return true;
      if (value.hasUnknownStatics) return null;
      const definition = value.definition;
      if (definition.kind === "builtin") return null;
      if (definition.kind === "class") {
        return key === "prototype" || key in Function.prototype || hasStaticMember(definition, key);
      }
      return key in Object.prototype || (DEFINITION_KEYS[definition.kind]?.includes(key) ?? false);
    }
    case "regexp":
      return key in REGEXP_INSTANCE;
    case "global":
      return getGlobalMember(value, key).kind !== "unknown";
    default:
      return null;
  }
};

/**
 * Static property read, mirroring what the runtime would observe on each
 * kind of value. Unknown objects produce unknown properties that remember
 * the access path so diagnostics stay readable.
 */
export const getProperty = (
  interpreter: Interpreter,
  target: StaticValue,
  key: string,
): StaticValue => {
  switch (target.kind) {
    case "object":
      return getObjectProperty(target, key);
    case "array": {
      if (key === "length") {
        return target.items.some((item) => item.kind === "optional")
          ? unknown("array.length")
          : literal(target.items.length);
      }
      const index = getIndex(key);
      if (index !== null) return selectItem(target.items, index);
      return (
        target.properties.get(key) ?? (key in Array.prototype ? unknown(`array.${key}`) : UNDEFINED)
      );
    }
    case "list":
      return key === "length" ? unknown(`${target.description}.length`) : unknown(`list.${key}`);
    case "element":
      switch (key) {
        case "props":
          return target.props;
        case "key":
          return target.key ?? NULL;
        case "type":
          return target.type;
        case "$$typeof":
          return literal(interpreter.elementType);
        case "ref":
          return target.props.properties.get("ref") ?? NULL;
        default:
          return ELEMENT_DEVELOPMENT_KEYS.has(key) ? unknown(`element.${key}`) : UNDEFINED;
      }
    case "literal": {
      const { value } = target;
      if (typeof value === "string") {
        if (key === "length") return literal(value.length);
        const index = getIndex(key);
        if (index !== null) return index < value.length ? literal(value[index]) : UNDEFINED;
      }
      return hasProperty(target, key) === false
        ? UNDEFINED
        : unknown(`${describeValue(target)}.${key}`);
    }
    case "regexp":
      if (key === "source") return literal(target.pattern);
      if (key === "flags") return literal(target.flags);
      return hasProperty(target, key) ? unknown(`/${target.pattern}/.${key}`) : UNDEFINED;
    case "conditional":
      return conditional(
        target.test,
        getProperty(interpreter, target.whenTrue, key),
        getProperty(interpreter, target.whenFalse, key),
      );
    case "optional":
      return getProperty(interpreter, readItem(target), key);
    case "namespace":
      return interpreter.getModuleExport(target.module, key);
    case "external":
      return accessExternalMember(target, key);
    case "global":
      return getGlobalMember(target, key);
    case "component":
      return target.statics.get(key) ?? getComponentProperty(target, key);
    case "function": {
      const assigned = target.statics.get(key);
      if (assigned) return assigned;
      if (key === "name") return literal(target.name ?? "");
      return hasProperty(target, key) === false
        ? UNDEFINED
        : unknown(`${target.name ?? "function"}.${key}`);
    }
    case "text":
      return key === "length" ? unknown("text.length") : unknown(`text.${key}`);
    case "unknown":
      return unknown(`${target.description}.${key}`);
  }
};

/** `$$typeof` of the wrapper objects React creates (`shared/ReactSymbols.js`); classes have none. */
const TYPEOF_BY_DEFINITION: Partial<Record<ComponentDefinition["kind"], StaticValue>> = {
  memo: literal(Symbol.for("react.memo")),
  forwardRef: literal(Symbol.for("react.forward_ref")),
  lazy: literal(Symbol.for("react.lazy")),
  class: UNDEFINED,
};

/**
 * Static members of component values. `displayName` reads `undefined`
 * because an assigned display name is folded into the definition's `name`.
 */
const getComponentProperty = (value: ComponentValue, key: string): StaticValue => {
  const definition = value.definition;
  if (definition.kind === "context") {
    if (key === "Provider") return component({ ...definition, role: "provider" }, value.statics);
    if (key === "Consumer") return component({ ...definition, role: "consumer" }, value.statics);
  }
  if (key === "displayName") return UNDEFINED;
  if (key === "name")
    return definition.kind === "class" ? literal(definition.name ?? "") : UNDEFINED;
  if (key === "$$typeof") {
    return (
      TYPEOF_BY_DEFINITION[definition.kind] ?? unknown(`${definition.kind} component.$$typeof`)
    );
  }
  if (key === "render" && definition.kind === "forwardRef" && definition.render) {
    return definition.render;
  }
  if (key === "type" && definition.kind === "memo") return definition.inner;
  if (key === "defaultProps" && definition.kind === "class") {
    return definition.defaultProps ?? UNDEFINED;
  }
  return hasProperty(value, key) === false
    ? UNDEFINED
    : unknown(`${definition.kind} component.${key}`);
};

/** Shape of one element of an iterable value. */
export const getIterationItem = (value: StaticValue, description: string): StaticValue => {
  switch (value.kind) {
    case "list":
      return value.item;
    case "array": {
      const [only] = value.items;
      if (value.items.length !== 1) return unknown(`item of ${description}`);
      return only.kind === "optional" ? only.value : only;
    }
    default:
      return unknown(`item of ${description}`);
  }
};

/** Appends one level of `value` the way `flat()` does: arrays and lists open up, anything else is kept. */
export const flattenInto = (items: StaticValue[], value: StaticValue): void => {
  switch (value.kind) {
    case "array":
      items.push(...value.items);
      return;
    case "list":
      items.push({ ...value, isInline: true });
      return;
    case "optional": {
      const inner: StaticValue[] = [];
      flattenInto(inner, value.value);
      for (const item of inner) items.push(optional(value.test, item));
      return;
    }
    default:
      items.push(value);
  }
};

/** A mutation that cannot be tracked leaves the array holding any number of unknown items. */
export const forgetArrayItems = (target: ArrayValue, description: string): StaticValue => {
  target.items.splice(0, target.items.length, {
    ...list(unknown(description), description),
    isInline: true,
  });
  return unknown(description);
};

/** Appends the elements of `...value`; a spread list marks its items as inline siblings. */
export const spreadInto = (items: StaticValue[], value: StaticValue): void => {
  if (value.kind === "array" || value.kind === "list") flattenInto(items, value);
  else items.push(unknown(`spread of ${value.kind}`));
};

import { getReactApiReference } from "../link/react-api.js";
import type { Interpreter } from "./interpreter.js";
import {
  builtin,
  type BuiltinComponentName,
  component,
  conditional,
  type ExternalValue,
  getObjectProperty,
  literal,
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
  if (!reference || reference.source !== "react") return value;
  const builtinName = BUILTIN_COMPONENT_BY_API[reference.api];
  return builtinName ? builtin(builtinName) : value;
};

export const accessExternalMember = (value: ExternalValue, member: string): StaticValue =>
  normalizeExternal({
    ...value,
    memberPath: [...value.memberPath, member],
    name: value.name ? `${value.name}.${member}` : member,
  });

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
      if (key === "length") return literal(target.items.length);
      const index = Number(key);
      if (Number.isInteger(index)) return target.items[index] ?? UNDEFINED;
      return unknown(`array.${key}`);
    }
    case "list":
      return key === "length" ? unknown(`${target.description}.length`) : unknown(`list.${key}`);
    case "element":
      switch (key) {
        case "props":
          return target.props;
        case "key":
          return target.key ?? UNDEFINED;
        case "type":
          return target.type;
        default:
          return unknown(`element.${key}`);
      }
    case "literal":
      if (typeof target.value === "string" && key === "length") return literal(target.value.length);
      return unknown(`${JSON.stringify(target.value)}.${key}`);
    case "conditional":
      return conditional(
        target.test,
        getProperty(interpreter, target.whenTrue, key),
        getProperty(interpreter, target.whenFalse, key),
      );
    case "namespace":
      return interpreter.getModuleExport(target.module, key);
    case "external":
      return accessExternalMember(target, key);
    case "component":
      if (target.definition.kind === "context") {
        if (key === "Provider") return component({ ...target.definition, role: "provider" });
        if (key === "Consumer") return component({ ...target.definition, role: "consumer" });
      }
      return unknown(`${target.definition.kind} component.${key}`);
    case "function":
      return unknown(`${target.name ?? "function"}.${key}`);
    case "text":
      return key === "length" ? unknown("text.length") : unknown(`text.${key}`);
    case "unknown":
      return unknown(`${target.description}.${key}`);
  }
};

/** Elements of an iterable value, or `null` when the count is unknown. */
export const getArrayItems = (value: StaticValue): StaticValue[] | null => {
  if (value.kind === "array") return value.items;
  if (value.kind === "literal" && typeof value.value === "string") {
    return [...value.value].map((character) => literal(character));
  }
  return null;
};

/** Shape of one element of an iterable value. */
export const getIterationItem = (value: StaticValue, description: string): StaticValue => {
  switch (value.kind) {
    case "list":
      return value.item;
    case "array":
      return value.items.length === 1 ? value.items[0] : unknown(`item of ${description}`);
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
    default:
      items.push(value);
  }
};

/** Appends the elements of `...value`; a spread list marks its items as inline siblings. */
export const spreadInto = (items: StaticValue[], value: StaticValue): void => {
  if (value.kind === "array" || value.kind === "list") flattenInto(items, value);
  else items.push(unknown(`spread of ${value.kind}`));
};

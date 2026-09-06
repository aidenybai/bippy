import type { CallbackInvoker } from "./react-calls.js";
import {
  array,
  list,
  literal,
  NULL,
  type Primitive,
  type RegExpValue,
  type StaticValue,
  text,
  toRegExp,
  unknown,
} from "./values.js";

/** Pure `String.prototype` methods that are run for real when every operand is known. */
const STRING_METHODS = new Set([
  "at",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "concat",
  "endsWith",
  "includes",
  "indexOf",
  "lastIndexOf",
  "localeCompare",
  "match",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "search",
  "slice",
  "split",
  "startsWith",
  "substring",
  "substr",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "toLowerCase",
  "toString",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
  "valueOf",
]);

const STRING_METHODS_RETURNING_STRING = new Set([
  "at",
  "charAt",
  "concat",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "slice",
  "substring",
  "substr",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "toLowerCase",
  "toString",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
  "valueOf",
]);

const REGEXP_METHODS = new Set(["test", "exec", "toString"]);

type ConcreteArgument = Primitive | RegExp | ((...callbackArguments: unknown[]) => Primitive);

const UNCONVERTIBLE = Symbol("unconvertible");

interface Concretization {
  invoke: CallbackInvoker;
  isPrecise: boolean;
}

const isStringValue = (value: StaticValue): value is StaticValue & { kind: "literal" | "text" } =>
  value.kind === "text" || (value.kind === "literal" && typeof value.value === "string");

const fromConcrete = (value: unknown): StaticValue => {
  if (Array.isArray(value)) return array(value.map(fromConcrete));
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "undefined":
      return literal(value);
    default:
      return value === null ? NULL : unknown("string method result");
  }
};

/**
 * Lowers a static value to the JavaScript value a string method needs.
 * Closures become real callbacks that run through the interpreter; a
 * callback result that is not a literal taints the whole computation.
 */
const toConcrete = (
  value: StaticValue,
  concretization: Concretization,
): ConcreteArgument | typeof UNCONVERTIBLE => {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "regexp":
      return toRegExp(value);
    case "function":
      return (...callbackArguments) => {
        const result = concretization.invoke(value, callbackArguments.map(fromConcrete));
        if (result.kind === "literal") return result.value;
        concretization.isPrecise = false;
        return "";
      };
    default:
      return UNCONVERTIBLE;
  }
};

const runConcretely = (
  receiver: string | RegExp,
  method: string,
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
): StaticValue | null => {
  const concretization: Concretization = { invoke, isPrecise: true };
  const concreteArguments: ConcreteArgument[] = [];
  for (const argument of callArguments) {
    const concrete = toConcrete(argument, concretization);
    if (concrete === UNCONVERTIBLE) return null;
    concreteArguments.push(concrete);
  }
  const implementation = Reflect.get(Object(receiver), method);
  if (typeof implementation !== "function") return null;
  try {
    const result = Reflect.apply(implementation, receiver, concreteArguments);
    return concretization.isPrecise ? fromConcrete(result) : null;
  } catch {
    return null;
  }
};

/** Method calls on string receivers; `null` when the method is not a string method. */
export const evaluateStringMethod = (
  target: StaticValue,
  method: string,
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  description: string,
): StaticValue | null => {
  if (!isStringValue(target) || !STRING_METHODS.has(method)) return null;
  if (target.kind === "literal" && typeof target.value === "string") {
    const concrete = runConcretely(target.value, method, callArguments, invoke);
    if (concrete) return concrete;
  }
  if (method === "split") return list(text(`part of ${description}`), description);
  return STRING_METHODS_RETURNING_STRING.has(method) ? text(description) : unknown(description);
};

/** `test`, `exec` and `toString` on regular expression literals. */
export const evaluateRegExpMethod = (
  target: RegExpValue,
  method: string,
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  description: string,
): StaticValue | null => {
  if (!REGEXP_METHODS.has(method)) return null;
  return runConcretely(toRegExp(target), method, callArguments, invoke) ?? unknown(description);
};

import { flattenInto, getIterationItem } from "./access.js";
import type { EvaluationContext } from "./interpreter.js";
import type { CallbackInvoker } from "./react-calls.js";
import {
  array,
  conditional,
  FALSE,
  getTruthiness,
  list,
  literal,
  mergeObjects,
  object,
  type StaticValue,
  text,
  TRUE,
  UNDEFINED,
  unknown,
} from "./values.js";

export const GLOBAL_NAMESPACES = new Set([
  "Object",
  "Array",
  "JSON",
  "Math",
  "String",
  "Number",
  "Boolean",
  "Date",
  "Promise",
  "Symbol",
  "Reflect",
  "Intl",
  "console",
  "window",
  "document",
  "globalThis",
  "navigator",
  "process",
]);

const ARRAY_LIKE_METHODS = new Set([
  "map",
  "flatMap",
  "filter",
  "forEach",
  "slice",
  "concat",
  "reverse",
  "toReversed",
  "sort",
  "toSorted",
  "flat",
  "join",
  "find",
  "findLast",
  "at",
  "some",
  "every",
  "includes",
  "indexOf",
  "findIndex",
  "reduce",
  "push",
  "unshift",
  "pop",
  "shift",
  "splice",
  "entries",
  "keys",
  "values",
]);

const isCallable = (value: StaticValue | undefined): value is StaticValue =>
  value !== undefined && value.kind === "function";

/**
 * Array method semantics on the three iterable shapes: known arrays keep
 * per-item precision, lists stay lists and unknown receivers become lists
 * of whatever the callback produces from an unknown item.
 */
export const evaluateArrayMethod = (
  target: StaticValue,
  method: string,
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  description: string,
  context: EvaluationContext,
): StaticValue | null => {
  if (!ARRAY_LIKE_METHODS.has(method)) return null;
  const items = target.kind === "array" ? target.items : null;
  const itemShape = getIterationItem(target, description);
  const [callback, secondArgument] = callArguments;
  const mapItems = (
    mapper: (item: StaticValue, index: StaticValue) => StaticValue,
    isFlat: boolean,
  ): StaticValue => {
    if (!items) return list(mapper(itemShape, unknown("index")), description, isFlat);
    const mapped = items.map((item, index) => mapper(item, literal(index)));
    if (!isFlat) return array(mapped);
    const flattened: StaticValue[] = [];
    for (const mappedItem of mapped) flattenInto(flattened, mappedItem);
    return array(flattened);
  };
  const asIndex = (value: StaticValue | undefined, fallback: number): number | null => {
    if (value === undefined) return fallback;
    return value.kind === "literal" && typeof value.value === "number" ? value.value : null;
  };
  switch (method) {
    case "map":
    case "flatMap":
      if (!isCallable(callback)) return unknown(description);
      return mapItems((item, index) => invoke(callback, [item, index, target]), method === "flatMap");
    case "filter": {
      if (!isCallable(callback)) return unknown(description);
      if (!items) return target.kind === "list" ? target : unknown(description);
      const kept: StaticValue[] = [];
      items.forEach((item, index) => {
        const verdict = getTruthiness(invoke(callback, [item, literal(index), target]));
        if (verdict === true) kept.push(item);
        else if (verdict === null) kept.push(conditional(description, item, UNDEFINED));
      });
      return array(kept);
    }
    case "forEach":
      if (isCallable(callback)) invoke(callback, [itemShape, unknown("index"), target]);
      return UNDEFINED;
    case "slice": {
      if (!items) return target.kind === "list" ? target : unknown(description);
      const start = asIndex(callback, 0);
      const end = asIndex(secondArgument, items.length);
      if (start === null || end === null) return list(itemShape, description);
      return array(items.slice(start, end));
    }
    case "concat": {
      if (!items) return unknown(description);
      const combined = [...items];
      for (const argument of callArguments) flattenInto(combined, argument);
      return array(combined);
    }
    case "reverse":
    case "toReversed":
      return items ? array([...items].reverse()) : target.kind === "list" ? target : unknown(description);
    case "sort":
    case "toSorted":
      if (items && items.length <= 1) return array(items);
      return target.kind === "list" ? target : list(itemShape, description);
    case "flat": {
      if (!items) return target.kind === "list" ? list(target.item, description, true) : unknown(description);
      const flattened: StaticValue[] = [];
      for (const item of items) flattenInto(flattened, item);
      return array(flattened);
    }
    case "join":
      return text(description);
    case "push":
    case "unshift": {
      if (target.kind !== "array") return unknown(description);
      const pushed = context.isInsideLoop
        ? callArguments.map((argument) => ({ ...list(argument, description), isInline: true }))
        : callArguments;
      if (method === "push") target.items.push(...pushed);
      else target.items.unshift(...pushed);
      return literal(target.items.length);
    }
    case "at": {
      if (items && callback?.kind === "literal" && typeof callback.value === "number") {
        return items.at(callback.value) ?? UNDEFINED;
      }
      return unknown(description);
    }
    case "includes":
    case "some":
    case "every":
      if (items && items.length === 0) return method === "every" ? TRUE : FALSE;
      return unknown(description);
    default:
      return unknown(description);
  }
};

const STRING_METHODS_RETURNING_STRING = new Set([
  "toUpperCase",
  "toLowerCase",
  "trim",
  "trimStart",
  "trimEnd",
  "slice",
  "substring",
  "substr",
  "replace",
  "replaceAll",
  "padStart",
  "padEnd",
  "repeat",
  "concat",
  "normalize",
  "toString",
  "toLocaleUpperCase",
  "toLocaleLowerCase",
  "charAt",
  "at",
]);

export const evaluateStringMethod = (
  target: StaticValue,
  method: string,
  callArguments: StaticValue[],
  description: string,
): StaticValue | null => {
  if (target.kind !== "text" && !(target.kind === "literal" && typeof target.value === "string")) {
    return null;
  }
  if (target.kind === "literal" && typeof target.value === "string") {
    const receiver = target.value;
    const literalArguments = callArguments.every((argument) => argument.kind === "literal")
      ? callArguments.map((argument) => (argument.kind === "literal" ? argument.value : undefined))
      : null;
    if (literalArguments) {
      switch (method) {
        case "toUpperCase":
          return literal(receiver.toUpperCase());
        case "toLowerCase":
          return literal(receiver.toLowerCase());
        case "trim":
          return literal(receiver.trim());
        case "split":
          return array(receiver.split(String(literalArguments[0])).map((part) => literal(part)));
        case "slice":
          return literal(
            receiver.slice(Number(literalArguments[0] ?? 0), Number(literalArguments[1] ?? receiver.length)),
          );
        case "charAt":
          return literal(receiver.charAt(Number(literalArguments[0] ?? 0)));
        case "replace":
        case "replaceAll":
          if (typeof literalArguments[0] === "string" && typeof literalArguments[1] === "string") {
            return literal(
              method === "replace"
                ? receiver.replace(literalArguments[0], literalArguments[1])
                : receiver.replaceAll(literalArguments[0], literalArguments[1]),
            );
          }
          break;
        case "startsWith":
          return literal(receiver.startsWith(String(literalArguments[0])));
        case "endsWith":
          return literal(receiver.endsWith(String(literalArguments[0])));
        case "includes":
          return literal(receiver.includes(String(literalArguments[0])));
      }
    }
  }
  if (STRING_METHODS_RETURNING_STRING.has(method)) return text(description);
  return unknown(description);
};

const toStringValue = (value: StaticValue, description: string): StaticValue => {
  if (value.kind === "literal") return literal(String(value.value));
  return value.kind === "text" ? value : text(description);
};

/**
 * Calls on well-known globals (`Object.keys`, `Array.from`, `String(x)`…)
 * that appear in render code. Returns `null` for anything unmodelled.
 */
export const evaluateGlobalCall = (
  chain: string[],
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  description: string,
): StaticValue | null => {
  const [first, second] = callArguments;
  switch (chain.join(".")) {
    case "Object.keys":
      if (first?.kind === "object" && !first.hasUnknownSpread) {
        return array([...first.properties.keys()].map((key) => literal(key)));
      }
      return unknown(description);
    case "Object.values":
      if (first?.kind === "object" && !first.hasUnknownSpread) {
        return array([...first.properties.values()]);
      }
      return unknown(description);
    case "Object.entries":
      if (first?.kind === "object" && !first.hasUnknownSpread) {
        return array(
          [...first.properties.entries()].map(([key, value]) => array([literal(key), value])),
        );
      }
      return unknown(description);
    case "Object.assign": {
      if (!first) return UNDEFINED;
      if (first.kind === "object") {
        for (const source of callArguments.slice(1)) {
          if (source.kind === "object") mergeObjects(first, source);
          else if (source.kind !== "literal") first.hasUnknownSpread = true;
        }
      }
      return first;
    }
    case "Object.freeze":
    case "Object.seal":
    case "structuredClone":
    case "Promise.resolve":
      return first ?? UNDEFINED;
    case "Object.fromEntries": {
      if (first?.kind !== "array") return unknown(description);
      const result = object();
      for (const entry of first.items) {
        if (entry.kind !== "array" || entry.items[0]?.kind !== "literal") {
          result.hasUnknownSpread = true;
          continue;
        }
        result.properties.set(String(entry.items[0].value), entry.items[1] ?? UNDEFINED);
      }
      return result;
    }
    case "Object.create":
      return object();
    case "Array.isArray":
      if (!first || first.kind === "unknown" || first.kind === "conditional") return unknown(description);
      return first.kind === "array" || first.kind === "list" ? TRUE : FALSE;
    case "Array.of":
      return array(callArguments);
    case "Array.from": {
      if (!first) return array([]);
      const mapper = second;
      if (first.kind === "array") {
        return isCallable(mapper)
          ? array(first.items.map((item, index) => invoke(mapper, [item, literal(index)])))
          : first;
      }
      const item = first.kind === "list" ? first.item : unknown(`item of ${description}`);
      return list(isCallable(mapper) ? invoke(mapper, [item, unknown("index")]) : item, description);
    }
    case "String":
      return first ? toStringValue(first, description) : literal("");
    case "String.raw":
      return text(description);
    case "Number":
    case "parseInt":
    case "parseFloat":
      if (first?.kind === "literal") return literal(Number(first.value));
      return unknown(description);
    case "Boolean": {
      if (!first) return FALSE;
      const truthiness = getTruthiness(first);
      return truthiness === null ? unknown(description) : literal(truthiness);
    }
    case "JSON.stringify":
      if (first?.kind === "literal") return literal(JSON.stringify(first.value) ?? "undefined");
      return text(description);
    case "console.log":
    case "console.warn":
    case "console.error":
    case "console.info":
    case "console.debug":
      return UNDEFINED;
    default:
      return chain[0] === "Math" || chain[0] === "Date" || chain[0] === "Intl"
        ? unknown(description)
        : null;
  }
};

import type { SourceLocation, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import {
  branchValue,
  describeValue,
  FALSE_VALUE,
  getKnownObjectKeys,
  getListLength,
  getObjectProperty,
  getTruthiness,
  isKnownList,
  listValue,
  objectValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const PROMISE_METHOD_NAMES = new Set(["then", "catch", "finally"]);

export const isPromiseMethodName = (name: string): boolean => PROMISE_METHOD_NAMES.has(name);

const GLOBAL_NAMES = new Set([
  "Object",
  "Array",
  "Math",
  "JSON",
  "String",
  "Number",
  "Boolean",
  "Date",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Promise",
  "Symbol",
  "Error",
  "RegExp",
  "Intl",
  "Reflect",
  "console",
  "window",
  "document",
  "globalThis",
  "navigator",
  "location",
  "process",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "fetch",
  "structuredClone",
  "queueMicrotask",
  "URL",
  "URLSearchParams",
  "Infinity",
  "NaN",
]);

const STRING_RESULT_METHODS = new Set([
  "toString",
  "toLocaleString",
  "toUpperCase",
  "toLowerCase",
  "trim",
  "trimStart",
  "trimEnd",
  "padStart",
  "padEnd",
  "replace",
  "replaceAll",
  "substring",
  "substr",
  "charAt",
  "concat",
  "normalize",
  "toFixed",
  "toPrecision",
  "join",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toISOString",
  "toDateString",
  "format",
]);

const BOOLEAN_RESULT_METHODS = new Set([
  "includes",
  "some",
  "every",
  "startsWith",
  "endsWith",
  "has",
  "hasOwnProperty",
  "test",
  "isArray",
]);

const NUMBER_RESULT_METHODS = new Set([
  "indexOf",
  "lastIndexOf",
  "findIndex",
  "findLastIndex",
  "localeCompare",
  "charCodeAt",
  "codePointAt",
  "getTime",
  "getFullYear",
  "getMonth",
  "getDate",
  "getDay",
  "getHours",
  "getMinutes",
  "getSeconds",
  "valueOf",
  "push",
  "unshift",
  "size",
]);

const LIST_PRESERVING_METHODS = new Set([
  "filter",
  "slice",
  "sort",
  "toSorted",
  "reverse",
  "toReversed",
  "concat",
  "flat",
  "values",
  "toArray",
]);

export const getBuiltinGlobal = (name: string): StaticValue | null => {
  if (name === "NaN") return primitiveValue(Number.NaN);
  if (name === "Infinity") return primitiveValue(Number.POSITIVE_INFINITY);
  if (name === "process.env" || name.startsWith("process.env.")) {
    return name === "process.env"
      ? { kind: "global", name }
      : unknownPrimitiveValue(
          "string",
          `environment variable ${name.slice("process.env.".length)}`,
        );
  }
  if (name.startsWith("Math.") && name !== "Math.max" && name !== "Math.min") {
    const constant = name.slice("Math.".length);
    if (constant === "PI") return primitiveValue(Math.PI);
    if (constant === "E") return primitiveValue(Math.E);
  }
  const root = name.split(".")[0];
  if (!GLOBAL_NAMES.has(root)) return null;
  return { kind: "global", name };
};

const toStringValue = (value: StaticValue): StaticValue => {
  if (value.kind === "primitive") return primitiveValue(String(value.value));
  return unknownPrimitiveValue("string", `String(${describeValue(value)})`);
};

const toNumberValue = (value: StaticValue): StaticValue => {
  if (value.kind === "primitive" && typeof value.value !== "bigint")
    return primitiveValue(Number(value.value));
  return unknownPrimitiveValue("number", `Number(${describeValue(value)})`);
};

const toBooleanValue = (value: StaticValue): StaticValue => {
  const truthiness = getTruthiness(value);
  if (truthiness === null)
    return unknownPrimitiveValue("boolean", `Boolean(${describeValue(value)})`);
  return truthiness ? TRUE_VALUE : FALSE_VALUE;
};

const callGlobal = (
  interpreter: Interpreter,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  isConstructor: boolean,
): StaticValue => {
  const [first, second] = args;
  switch (name) {
    case "String":
      return first ? toStringValue(first) : primitiveValue("");
    case "Number":
      return first ? toNumberValue(first) : primitiveValue(0);
    case "Boolean":
      return first ? toBooleanValue(first) : FALSE_VALUE;
    case "Array":
      return isConstructor || args.length !== 1
        ? listValue(args)
        : unknownValue("Array(length)", location);
    case "Array.isArray":
      if (!first) return FALSE_VALUE;
      if (first.kind === "list" || first.kind === "repeat") return TRUE_VALUE;
      if (first.kind === "unknown" || first.kind === "branch") {
        return unknownPrimitiveValue("boolean", "Array.isArray on dynamic value");
      }
      return FALSE_VALUE;
    case "Array.from": {
      const source = first?.kind === "object" ? arrayLikeToList(first) : first;
      if (source?.kind === "list" || source?.kind === "repeat") {
        if (second?.kind === "function") return mapList(interpreter, source, second, context);
        return source;
      }
      return unknownValue("Array.from of dynamic iterable", location);
    }
    case "Object.keys":
    case "Object.values":
    case "Object.entries": {
      if (first?.kind !== "object")
        return unknownValue(`${name} of ${first ? describeValue(first) : "nothing"}`, location);
      const keys = getKnownObjectKeys(first);
      if (!keys) return unknownValue(`${name} of an object with dynamic spreads`, location);
      if (name === "Object.keys") return listValue(keys.map((key) => primitiveValue(key)));
      if (name === "Object.values")
        return listValue(keys.map((key) => getObjectProperty(first, key)));
      return listValue(
        keys.map((key) => listValue([primitiveValue(key), getObjectProperty(first, key)])),
      );
    }
    case "Object.assign":
      return objectValue(args.map((argument) => ({ kind: "spread", value: argument })));
    case "Object.freeze":
    case "Object.seal":
      return first ?? UNDEFINED_VALUE;
    case "Object.fromEntries":
      if (first && isKnownList(first)) {
        const entries = first.items.map((entry) => {
          const key = entry.kind === "list" ? entry.items[0] : null;
          const value = entry.kind === "list" ? entry.items[1] : null;
          if (key?.kind === "primitive" && value) {
            return { kind: "property" as const, key: String(key.value), value };
          }
          return { kind: "spread" as const, value: unknownValue("dynamic entry") };
        });
        return objectValue(entries);
      }
      return unknownValue("Object.fromEntries of dynamic entries", location);
    case "parseInt":
    case "parseFloat":
      if (first?.kind === "primitive" && typeof first.value === "string") {
        return primitiveValue(
          name === "parseInt" ? Number.parseInt(first.value, 10) : Number.parseFloat(first.value),
        );
      }
      return unknownPrimitiveValue("number", name);
    case "JSON.stringify":
      return unknownPrimitiveValue("string", "JSON.stringify");
    case "JSON.parse":
      return unknownValue("JSON.parse", location);
    case "console.log":
    case "console.warn":
    case "console.error":
    case "console.info":
    case "console.debug":
      return UNDEFINED_VALUE;
    default:
      break;
  }
  if (name.startsWith("Math.")) {
    if (
      args.every((argument) => argument.kind === "primitive" && typeof argument.value === "number")
    ) {
      const numbers = args.map((argument) =>
        argument.kind === "primitive" ? Number(argument.value) : 0,
      );
      const method = name.slice("Math.".length);
      switch (method) {
        case "max":
          return primitiveValue(Math.max(...numbers));
        case "min":
          return primitiveValue(Math.min(...numbers));
        case "floor":
          return primitiveValue(Math.floor(numbers[0]));
        case "ceil":
          return primitiveValue(Math.ceil(numbers[0]));
        case "round":
          return primitiveValue(Math.round(numbers[0]));
        case "abs":
          return primitiveValue(Math.abs(numbers[0]));
        default:
          break;
      }
    }
    return unknownPrimitiveValue("number", name);
  }
  if (isConstructor) return unknownValue(`new ${name}()`, location);
  return unknownValue(`${name}()`, location);
};

const MAX_ARRAY_LIKE_LENGTH = 1_000;

// `{ length: n }` (and sparse array-likes) as consumed by `Array.from`.
const arrayLikeToList = (value: Extract<StaticValue, { kind: "object" }>): StaticValue => {
  const length = getObjectProperty(value, "length");
  if (length.kind !== "primitive" || typeof length.value !== "number") {
    return unknownValue("Array.from of an array-like with dynamic length", null);
  }
  if (!Number.isInteger(length.value) || length.value < 0 || length.value > MAX_ARRAY_LIKE_LENGTH) {
    return { kind: "repeat", item: UNDEFINED_VALUE, location: null };
  }
  return listValue(
    Array.from({ length: length.value }, (_, index) => getObjectProperty(value, String(index))),
  );
};

const mapList = (
  interpreter: Interpreter,
  receiver: StaticValue,
  callback: Extract<StaticValue, { kind: "function" }>,
  context: EvaluationContext,
): StaticValue => {
  if (receiver.kind === "list") {
    return listValue(
      receiver.items.map((item, index) => {
        if (item.kind === "repeat") {
          return {
            kind: "repeat",
            item: interpreter.callFunction(
              callback,
              [item.item, unknownPrimitiveValue("number", "index"), receiver],
              context,
            ),
            location: item.location,
          };
        }
        return interpreter.callFunction(callback, [item, primitiveValue(index), receiver], context);
      }),
    );
  }
  if (receiver.kind === "repeat") {
    return {
      kind: "repeat",
      item: interpreter.callFunction(
        callback,
        [receiver.item, unknownPrimitiveValue("number", "index"), receiver],
        context,
      ),
      location: receiver.location,
    };
  }
  return {
    kind: "repeat",
    item: interpreter.callFunction(
      callback,
      [
        unknownValue(`item of ${describeValue(receiver)}`),
        unknownPrimitiveValue("number", "index"),
        receiver,
      ],
      context,
    ),
    location: null,
  };
};

const callStringMethod = (
  receiver: string,
  name: string,
  args: StaticValue[],
): StaticValue | null => {
  const primitiveArgs = args.map((argument) =>
    argument.kind === "primitive" ? argument.value : undefined,
  );
  const allKnown = args.every((argument) => argument.kind === "primitive");
  if (!allKnown) return null;
  switch (name) {
    case "toUpperCase":
      return primitiveValue(receiver.toUpperCase());
    case "toLowerCase":
      return primitiveValue(receiver.toLowerCase());
    case "trim":
      return primitiveValue(receiver.trim());
    case "slice":
      return primitiveValue(
        receiver.slice(
          Number(primitiveArgs[0] ?? 0),
          primitiveArgs[1] === undefined ? undefined : Number(primitiveArgs[1]),
        ),
      );
    case "charAt":
      return primitiveValue(receiver.charAt(Number(primitiveArgs[0] ?? 0)));
    case "split":
      return listValue(
        receiver.split(String(primitiveArgs[0] ?? "")).map((part) => primitiveValue(part)),
      );
    case "replace":
    case "replaceAll":
      if (typeof primitiveArgs[0] === "string" && typeof primitiveArgs[1] === "string") {
        return primitiveValue(
          name === "replace"
            ? receiver.replace(primitiveArgs[0], primitiveArgs[1])
            : receiver.replaceAll(primitiveArgs[0], primitiveArgs[1]),
        );
      }
      return null;
    case "includes":
      return primitiveValue(receiver.includes(String(primitiveArgs[0])));
    case "startsWith":
      return primitiveValue(receiver.startsWith(String(primitiveArgs[0])));
    case "endsWith":
      return primitiveValue(receiver.endsWith(String(primitiveArgs[0])));
    case "toString":
    case "valueOf":
      return primitiveValue(receiver);
    case "concat":
      return primitiveValue(receiver + primitiveArgs.map(String).join(""));
    case "repeat":
      return primitiveValue(receiver.repeat(Number(primitiveArgs[0] ?? 0)));
    default:
      return null;
  }
};

const fallbackMethodResult = (
  receiver: StaticValue,
  name: string,
  location: SourceLocation | null,
): StaticValue => {
  if (STRING_RESULT_METHODS.has(name)) return unknownPrimitiveValue("string", `${name}()`);
  if (BOOLEAN_RESULT_METHODS.has(name)) return unknownPrimitiveValue("boolean", `${name}()`);
  if (NUMBER_RESULT_METHODS.has(name)) return unknownPrimitiveValue("number", `${name}()`);
  if (
    LIST_PRESERVING_METHODS.has(name) &&
    (receiver.kind === "unknown" || receiver.kind === "repeat")
  ) {
    return receiver;
  }
  return unknownValue(`${describeValue(receiver)}.${name}()`, location);
};

export const evaluateBuiltinCall = (
  interpreter: Interpreter,
  callee: Extract<StaticValue, { kind: "method" | "global" }>,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  isConstructor = false,
): StaticValue => {
  if (callee.kind === "global")
    return callGlobal(interpreter, callee.name, args, context, location, isConstructor);
  const { receiver, name } = callee;
  const [first, second] = args;

  if (isPromiseMethodName(name)) {
    if (name === "then" && first?.kind === "function") {
      return interpreter.callFunction(first, [receiver], context);
    }
    return receiver;
  }

  if (receiver.kind === "function") {
    if (name === "bind") return { ...receiver, thisValue: first ?? receiver.thisValue };
    if (name === "call")
      return interpreter.callFunction(receiver, args.slice(1), context, {
        thisValue: first ?? null,
      });
    if (name === "apply") {
      return interpreter.callFunction(
        receiver,
        second?.kind === "list" ? second.items : [unknownValue("apply arguments")],
        context,
        { thisValue: first ?? null },
      );
    }
    return unknownValue(`function.${name}()`, location);
  }

  if (receiver.kind === "primitive" && typeof receiver.value === "string") {
    const computed = callStringMethod(receiver.value, name, args);
    if (computed) return computed;
  }

  if (receiver.kind === "global" && receiver.name === "process.env") {
    return unknownPrimitiveValue("string", "process.env access");
  }

  if (name === "map" && first?.kind === "function")
    return mapList(interpreter, receiver, first, context);

  if (name === "forEach" && first?.kind === "function") {
    if (receiver.kind === "list") {
      receiver.items.forEach((item, index) => {
        if (item.kind === "repeat")
          interpreter.callFunction(
            first,
            [item.item, unknownPrimitiveValue("number", "index")],
            context,
          );
        else interpreter.callFunction(first, [item, primitiveValue(index)], context);
      });
    }
    return UNDEFINED_VALUE;
  }

  if (name === "flatMap" && first?.kind === "function") {
    const mapped = mapList(interpreter, receiver, first, context);
    if (mapped.kind === "list") {
      const flattened: StaticValue[] = [];
      for (const item of mapped.items) {
        if (item.kind === "list") flattened.push(...item.items);
        else flattened.push(item);
      }
      return listValue(flattened);
    }
    return mapped;
  }

  if (receiver.kind === "list") {
    switch (name) {
      case "filter":
        if (first?.kind === "function" && isKnownList(receiver)) {
          const kept: StaticValue[] = [];
          receiver.items.forEach((item, index) => {
            const verdict = getTruthiness(
              interpreter.callFunction(first, [item, primitiveValue(index), receiver], context),
            );
            if (verdict === true) kept.push(item);
            else if (verdict === null)
              kept.push(branchValue([item, unknownValue("filtered out")], "uncertain filter"));
          });
          return listValue(kept);
        }
        return receiver;
      case "slice": {
        if (!isKnownList(receiver)) return receiver;
        const start = first?.kind === "primitive" ? Number(first.value) : undefined;
        const end = second?.kind === "primitive" ? Number(second.value) : undefined;
        if (first && start === undefined)
          return unknownValue("slice with dynamic bounds", location);
        return listValue(receiver.items.slice(start, end));
      }
      case "concat": {
        const items = [...receiver.items];
        for (const argument of args) {
          if (argument.kind === "list") items.push(...argument.items);
          else items.push(argument);
        }
        return listValue(items);
      }
      case "reverse":
      case "toReversed":
        return listValue([...receiver.items].reverse());
      case "sort":
      case "toSorted":
        return receiver;
      case "flat": {
        const items: StaticValue[] = [];
        for (const item of receiver.items) {
          if (item.kind === "list") items.push(...item.items);
          else items.push(item);
        }
        return listValue(items);
      }
      case "join":
        if (receiver.items.every((item) => item.kind === "primitive")) {
          const separator = first?.kind === "primitive" ? String(first.value) : ",";
          return primitiveValue(
            receiver.items
              .map((item) => (item.kind === "primitive" ? String(item.value ?? "") : ""))
              .join(separator),
          );
        }
        return unknownPrimitiveValue("string", "join of dynamic list");
      case "at": {
        if (first?.kind === "primitive" && isKnownList(receiver)) {
          const index = Number(first.value);
          return receiver.items.at(index) ?? UNDEFINED_VALUE;
        }
        return unknownValue("at() with dynamic index", location);
      }
      case "find":
      case "findLast": {
        const candidates = receiver.items.filter((item) => item.kind !== "repeat");
        return branchValue([...candidates, UNDEFINED_VALUE], `${name}()`, location);
      }
      case "reduce":
        return unknownValue("reduce()", location);
      case "push":
      case "unshift": {
        // Inside an uncertain path (e.g. a loop of unknown length) the pushed
        // items may occur any number of times, so they become a repeat.
        const pushed: StaticValue[] =
          context.uncertainDepth > 0
            ? [{ kind: "repeat", item: args.length === 1 ? args[0] : listValue(args), location }]
            : args;
        if (name === "push") receiver.items.push(...pushed);
        else receiver.items.unshift(...pushed);
        return getListLength(receiver);
      }
      default:
        break;
    }
  }

  return fallbackMethodResult(receiver, name, location);
};

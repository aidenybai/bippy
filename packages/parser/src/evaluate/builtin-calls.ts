import type {
  RenderEnvironment,
  SourceLocation,
  StaticFunctionValue,
  StaticRegExpValue,
  StaticValue,
} from "../types.js";
import type { EvaluationContext } from "./context.js";
import { createCollectionValue, createPromiseValue } from "./collections.js";
import { markEscapedSetters } from "./hooks.js";
import type { Interpreter } from "./interpreter.js";
import {
  branchValue,
  describeValue,
  FALSE_VALUE,
  getKnownObjectKeys,
  getListLength,
  getObjectProperty,
  getTruthiness,
  hasDefiniteItems,
  isKnownList,
  listValue,
  NULL_VALUE,
  objectValue,
  optionalValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const PROMISE_METHOD_NAMES = new Set(["then", "catch", "finally"]);

export const isPromiseMethodName = (name: string): boolean => PROMISE_METHOD_NAMES.has(name);

const ITERATION_METHOD_NAMES = new Set(["map", "forEach", "flatMap", "filter"]);

/** Methods whose callbacks run synchronously (or on promise settlement) even when the receiver is opaque. */
export const isModeledOpaqueMethodName = (name: string): boolean =>
  PROMISE_METHOD_NAMES.has(name) || ITERATION_METHOD_NAMES.has(name);

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
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
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

const BROWSER_GLOBALS = new Set(["window", "document", "navigator", "location"]);
const CONSTRUCTOR_GLOBALS = new Set([
  "Object",
  "Array",
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
]);

/** `typeof <global>` as observed by the rendering environment; null when it depends on the host. */
export const getGlobalTypeof = (
  name: string,
  environment: RenderEnvironment | null,
): string | null => {
  if (name.includes(".")) return null;
  if (BROWSER_GLOBALS.has(name)) return environment === "server" ? "undefined" : "object";
  if (CONSTRUCTOR_GLOBALS.has(name)) return "function";
  if (name === "Math" || name === "JSON" || name === "Intl" || name === "Reflect") return "object";
  if (name === "globalThis" || name === "console") return "object";
  return null;
};

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
    case "Map":
    case "Set":
      return createCollectionValue(name, first, location);
    case "Promise":
      return createPromiseValue(
        first,
        (executor, executorArgs) =>
          interpreter.callValue(executor, executorArgs, context, location),
        location,
      );
    case "Promise.resolve":
      return first ?? UNDEFINED_VALUE;
    case "Promise.reject":
      return { ...unknownValue("rejected promise", location), isThrown: true };
    case "Promise.all":
      return first?.kind === "list" ? first : unknownValue("Promise.all", location);
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
        if (isCallable(second)) return mapList(interpreter, source, second, context);
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
      // Statics attached to a function/class (`Object.assign(Component, {...})`)
      // do not change what it renders; keep the callable identity.
      if (first && first.kind !== "object" && first.kind !== "unknown" && first.kind !== "branch")
        return first;
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
    case "setTimeout":
    case "setImmediate":
    case "queueMicrotask":
    case "requestAnimationFrame":
    case "requestIdleCallback":
      // The runtime snapshot is taken once short timers settled; longer or dynamic delays may not have fired.
      if (first) {
        if (isSettledDelay(second)) interpreter.callValue(first, [], context, location);
        else markEscapedSetters(first);
      }
      return unknownValue(`${name} handle`, location);
    case "setInterval":
      if (first) markEscapedSetters(first);
      return unknownValue(`${name} handle`, location);
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

type CallableValue = Extract<StaticValue, { kind: "function" | "native-function" | "global" }>;

const MAX_SETTLED_DELAY_MS = 2_000;

const isSettledDelay = (delay: StaticValue | undefined): boolean =>
  delay === undefined ||
  (delay.kind === "primitive" &&
    (delay.value === undefined ||
      delay.value === null ||
      (typeof delay.value === "number" && delay.value <= MAX_SETTLED_DELAY_MS)));

const isCallable = (value: StaticValue | undefined): value is CallableValue =>
  value?.kind === "function" || value?.kind === "native-function" || value?.kind === "global";

const callCallback = (
  interpreter: Interpreter,
  callback: CallableValue,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue => interpreter.callValue(callback, args, context, null);

const mapList = (
  interpreter: Interpreter,
  receiver: StaticValue,
  callback: CallableValue,
  context: EvaluationContext,
): StaticValue => {
  if (receiver.kind === "list") {
    return listValue(
      receiver.items.map((item, index) => {
        if (item.kind === "repeat") {
          return {
            kind: "repeat",
            item: callCallback(
              interpreter,
              callback,
              [item.item, unknownPrimitiveValue("number", "index"), receiver],
              context,
            ),
            location: item.location,
          };
        }
        if (item.kind === "optional") {
          return optionalValue(
            callCallback(
              interpreter,
              callback,
              [item.value, unknownPrimitiveValue("number", "index"), receiver],
              context,
            ),
            item.reason,
            item.location,
          );
        }
        return callCallback(
          interpreter,
          callback,
          [item, primitiveValue(index), receiver],
          context,
        );
      }),
    );
  }
  if (receiver.kind === "repeat") {
    return {
      kind: "repeat",
      item: callCallback(
        interpreter,
        callback,
        [receiver.item, unknownPrimitiveValue("number", "index"), receiver],
        context,
      ),
      location: receiver.location,
    };
  }
  return {
    kind: "repeat",
    item: callCallback(
      interpreter,
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

const toRegExp = (value: StaticRegExpValue): RegExp | null => {
  try {
    return new RegExp(value.pattern, value.flags);
  } catch {
    return null;
  }
};

const toPattern = (value: StaticValue): string | RegExp | null => {
  if (value.kind === "primitive") return String(value.value);
  if (value.kind === "regexp") return toRegExp(value);
  return null;
};

const listOfStrings = (parts: (string | undefined)[]): StaticValue =>
  listValue(parts.map((part) => (part === undefined ? UNDEFINED_VALUE : primitiveValue(part))));

/** `String.prototype.replace` with a callback needs the callback to produce a known string on every match. */
const replaceWithCallback = (
  interpreter: Interpreter,
  receiver: string,
  pattern: string | RegExp,
  replacer: StaticFunctionValue,
  context: EvaluationContext,
  replaceAll: boolean,
): StaticValue | null => {
  let isKnown = true;
  const replaceMatch = (...matchArgs: (string | number)[]): string => {
    const result = interpreter.callFunction(
      replacer,
      matchArgs.map((matchArg) => primitiveValue(matchArg)),
      context,
    );
    if (result.kind === "primitive") return String(result.value);
    isKnown = false;
    return "";
  };
  const replaced = replaceAll
    ? receiver.replaceAll(pattern, replaceMatch)
    : receiver.replace(pattern, replaceMatch);
  return isKnown ? primitiveValue(replaced) : null;
};

const callStringMethod = (
  interpreter: Interpreter,
  receiver: string,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue | null => {
  const [first, second] = args;
  const primitiveArgs = args.map((argument) =>
    argument.kind === "primitive" ? argument.value : undefined,
  );
  const allKnown = args.every((argument) => argument.kind === "primitive");
  if (name === "split" || name === "replace" || name === "replaceAll") {
    const pattern = first ? toPattern(first) : null;
    if (pattern === null) return first ? null : listOfStrings([receiver]);
    if (name === "split") {
      const limit = second?.kind === "primitive" ? Number(second.value) : undefined;
      return listOfStrings(receiver.split(pattern, limit));
    }
    if (second?.kind === "function") {
      return replaceWithCallback(
        interpreter,
        receiver,
        pattern,
        second,
        context,
        name === "replaceAll",
      );
    }
    if (second?.kind !== "primitive") return null;
    const replacement = String(second.value);
    return primitiveValue(
      name === "replace"
        ? receiver.replace(pattern, replacement)
        : receiver.replaceAll(pattern, replacement),
    );
  }
  if (name === "match" && first?.kind === "regexp") {
    const regExp = toRegExp(first);
    if (!regExp) return null;
    const matched = receiver.match(regExp);
    return matched ? listOfStrings([...matched]) : NULL_VALUE;
  }
  if (!allKnown) return null;
  switch (name) {
    case "toUpperCase":
      return primitiveValue(receiver.toUpperCase());
    case "toLowerCase":
      return primitiveValue(receiver.toLowerCase());
    case "trim":
      return primitiveValue(receiver.trim());
    case "trimStart":
      return primitiveValue(receiver.trimStart());
    case "trimEnd":
      return primitiveValue(receiver.trimEnd());
    case "slice":
    case "substring": {
      const end = primitiveArgs[1] === undefined ? undefined : Number(primitiveArgs[1]);
      return primitiveValue(
        name === "slice"
          ? receiver.slice(Number(primitiveArgs[0] ?? 0), end)
          : receiver.substring(Number(primitiveArgs[0] ?? 0), end),
      );
    }
    case "charAt":
      return primitiveValue(receiver.charAt(Number(primitiveArgs[0] ?? 0)));
    case "at": {
      const character = receiver.at(Number(primitiveArgs[0] ?? 0));
      return character === undefined ? UNDEFINED_VALUE : primitiveValue(character);
    }
    case "indexOf":
      return primitiveValue(receiver.indexOf(String(primitiveArgs[0])));
    case "lastIndexOf":
      return primitiveValue(receiver.lastIndexOf(String(primitiveArgs[0])));
    case "padStart":
      return primitiveValue(
        receiver.padStart(Number(primitiveArgs[0] ?? 0), String(primitiveArgs[1] ?? " ")),
      );
    case "padEnd":
      return primitiveValue(
        receiver.padEnd(Number(primitiveArgs[0] ?? 0), String(primitiveArgs[1] ?? " ")),
      );
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
    case "localeCompare":
      return primitiveValue(receiver.localeCompare(String(primitiveArgs[0])));
    default:
      return null;
  }
};

const callRegExpMethod = (
  receiver: StaticRegExpValue,
  name: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const [first] = args;
  const regExp = toRegExp(receiver);
  if (!regExp) return unknownValue(`invalid RegExp /${receiver.pattern}/`, location);
  if (name !== "test" && name !== "exec") return unknownValue(`RegExp.${name}()`, location);
  if (first?.kind !== "primitive") {
    return name === "test"
      ? unknownPrimitiveValue("boolean", "RegExp.test() on a dynamic string")
      : unknownValue("RegExp.exec() on a dynamic string", location);
  }
  const input = String(first.value);
  if (name === "test") return primitiveValue(regExp.test(input));
  const matched = regExp.exec(input);
  return matched ? listOfStrings([...matched]) : NULL_VALUE;
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
      const isSettled = receiver.kind !== "unknown" && receiver.kind !== "external";
      return isSettled
        ? interpreter.callFunction(first, [receiver], context)
        : interpreter.callDeferred(first, [receiver], context);
    }
    if (!isCallable(first) && !isCallable(second)) return receiver;
    if (receiver.kind === "unknown" || receiver.kind === "external") {
      for (const callback of args) markEscapedSetters(callback);
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

  if (receiver.kind === "global") {
    if (name === "bind") return receiver;
    if (name === "call")
      return callGlobal(interpreter, receiver.name, args.slice(1), context, location, false);
    if (name === "apply") {
      return callGlobal(
        interpreter,
        receiver.name,
        second?.kind === "list" ? second.items : [unknownValue("apply arguments")],
        context,
        location,
        false,
      );
    }
  }

  if (
    (name === "call" || name === "apply") &&
    (receiver.kind === "class" ||
      (receiver.kind === "react-api" &&
        (receiver.api === "Component" || receiver.api === "PureComponent")))
  ) {
    return UNDEFINED_VALUE;
  }

  if (receiver.kind === "primitive" && typeof receiver.value === "string") {
    const computed = callStringMethod(interpreter, receiver.value, name, args, context);
    if (computed) return computed;
  }

  if (receiver.kind === "regexp") return callRegExpMethod(receiver, name, args, location);

  if (receiver.kind === "global" && receiver.name === "process.env") {
    return unknownPrimitiveValue("string", "process.env access");
  }

  if (name === "map" && isCallable(first)) return mapList(interpreter, receiver, first, context);

  if (name === "forEach" && isCallable(first)) {
    if (receiver.kind === "list") {
      receiver.items.forEach((item, index) => {
        if (item.kind === "repeat")
          callCallback(
            interpreter,
            first,
            [item.item, unknownPrimitiveValue("number", "index")],
            context,
          );
        else callCallback(interpreter, first, [item, primitiveValue(index)], context);
      });
    }
    return UNDEFINED_VALUE;
  }

  if (name === "flatMap" && isCallable(first)) {
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
        if (isCallable(first) && hasDefiniteItems(receiver)) {
          const kept: StaticValue[] = [];
          receiver.items.forEach((item, index) => {
            const verdict = getTruthiness(
              callCallback(interpreter, first, [item, primitiveValue(index), receiver], context),
            );
            if (verdict === true) kept.push(item);
            else if (verdict === null) kept.push(optionalValue(item, "uncertain filter"));
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
      case "reduceRight": {
        if (!isCallable(first) || !hasDefiniteItems(receiver)) {
          return unknownValue(`${name}()`, location);
        }
        const items = name === "reduce" ? receiver.items : [...receiver.items].reverse();
        let accumulator = args.length > 1 ? second : items[0];
        if (!accumulator) return unknownValue(`${name}() of an empty list`, location);
        const startIndex = args.length > 1 ? 0 : 1;
        for (let index = startIndex; index < items.length; index++) {
          const sourceIndex = name === "reduce" ? index : items.length - 1 - index;
          accumulator = callCallback(
            interpreter,
            first,
            [accumulator, items[index], primitiveValue(sourceIndex), receiver],
            context,
          );
        }
        return accumulator;
      }
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

import type {
  RenderEnvironment,
  SourceLocation,
  StaticElementType,
  StaticFunctionValue,
  StaticListValue,
  StaticObjectValue,
  StaticRegExpValue,
  StaticValue,
} from "../types.js";
import { getReactApiTypeof } from "../react/react-api.js";
import {
  ForwardRefTag,
  FunctionComponentTag,
  LazyComponentTag,
  MemoComponentTag,
  SimpleMemoComponentTag,
} from "../work-tags.js";
import { getBrowserGlobalMember, isBrowserGlobalName } from "./browser-globals.js";
import { mediaQueryListValue } from "./media-query.js";
import { callStorageMethod, getStorageAreaName } from "./web-storage.js";
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
  compareIdentity,
  hasDefiniteItems,
  isKnownList,
  listValue,
  mapValue,
  toBooleanValue,
  NULL_VALUE,
  objectValue,
  optionalValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  spreadListItems,
  unknownValue,
} from "./values.js";

const PROMISE_METHOD_NAMES = new Set(["then", "catch", "finally"]);

export const isPromiseMethodName = (name: string): boolean => PROMISE_METHOD_NAMES.has(name);

const ITERATION_METHOD_NAMES = new Set(["map", "forEach", "flatMap", "filter"]);

/** `flatMap`/`concat` flattening: arrays contribute their items, anything else itself. */
const flattenOneLevel = (value: StaticValue, location: SourceLocation | null): StaticValue[] =>
  spreadListItems(
    mapValue(value, (alternative) =>
      alternative.kind === "list" || alternative.kind === "unknown"
        ? alternative
        : listValue([alternative]),
    ),
    location,
  );

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
  "Proxy",
  "console",
  "window",
  "document",
  "globalThis",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
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

/** Static output is compared against dev servers and test renderers, which both bundle with a development `NODE_ENV`. */
const DEV_SERVER_NODE_ENV = "development";

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

const BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
]);
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
  "Proxy",
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

const getComponentTypeof = (type: StaticElementType): string | null => {
  switch (type.kind) {
    case "function":
    case "class":
      return "function";
    case "memo":
    case "forward-ref":
    case "lazy":
    case "context-provider":
    case "context-consumer":
      return "object";
    case "host":
      return "string";
    case "fragment":
    case "strict-mode":
    case "profiler":
    case "suspense":
    case "suspense-list":
    case "activity":
    case "view-transition":
      return "symbol";
    case "stub":
      switch (type.stub.tag ?? FunctionComponentTag) {
        case ForwardRefTag:
        case MemoComponentTag:
        case SimpleMemoComponentTag:
        case LazyComponentTag:
          return "object";
        default:
          return "function";
      }
    default:
      return null;
  }
};

export const getTypeofValue = (
  value: StaticValue,
  environment: RenderEnvironment | null,
): StaticValue => {
  switch (value.kind) {
    case "branch":
      return mapValue(value, (alternative) => getTypeofValue(alternative, environment));
    case "primitive":
      return primitiveValue(typeof value.value);
    case "function":
    case "class":
    case "native-function":
    case "method":
      return primitiveValue("function");
    case "react-api":
      return primitiveValue(getReactApiTypeof(value.api));
    case "component-reference": {
      const componentTypeof = getComponentTypeof(value.type);
      return componentTypeof
        ? primitiveValue(componentTypeof)
        : unknownPrimitiveValue("string", "typeof unknown");
    }
    case "proxy":
      return getTypeofValue(value.target, environment);
    case "host-node":
      return primitiveValue("object");
    case "symbol":
      return primitiveValue("symbol");
    case "object":
    case "list":
    case "element":
    case "namespace":
    case "context":
      return primitiveValue("object");
    case "external":
      return value.importedName === "*" && !value.derived
        ? primitiveValue("object")
        : unknownPrimitiveValue("string", "typeof unknown");
    case "global": {
      const globalType = getGlobalTypeof(value.name, environment);
      return globalType
        ? primitiveValue(globalType)
        : unknownPrimitiveValue("string", "typeof unknown");
    }
    default:
      return unknownPrimitiveValue("string", "typeof unknown");
  }
};

export const getBuiltinGlobal = (name: string): StaticValue | null => {
  if (name === "NaN") return primitiveValue(Number.NaN);
  if (name === "Infinity") return primitiveValue(Number.POSITIVE_INFINITY);
  if (name === "process.env.NODE_ENV") return primitiveValue(DEV_SERVER_NODE_ENV);
  if (name === "process.env") return { kind: "global", name };
  if (name.startsWith("process.env.")) {
    // Bundlers inline what the build environment set; an arbitrary variable is
    // usually unset, so `undefined` is the preferred alternative.
    const reason = `environment variable ${name.slice("process.env.".length)}`;
    return branchValue([UNDEFINED_VALUE, unknownPrimitiveValue("string", reason)], reason, null);
  }
  if (name.startsWith("Math.") && name !== "Math.max" && name !== "Math.min") {
    const constant = name.slice("Math.".length);
    if (constant === "PI") return primitiveValue(Math.PI);
    if (constant === "E") return primitiveValue(Math.E);
  }
  const root = name.split(".")[0];
  if (!GLOBAL_NAMES.has(root)) return null;
  if (root !== name && isBrowserGlobalName(root)) {
    const member = name.slice(root.length + 1);
    if ((root === "window" || root === "globalThis") && GLOBAL_NAMES.has(member))
      return getBuiltinGlobal(member);
    return getBrowserGlobalMember(root, member, getBuiltinGlobal);
  }
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

/**
 * Accessor descriptors are read once, when defined: the value a getter
 * produces on the render this code runs in is the value the property holds
 * (`getProxyFormState` in react-hook-form tracks which keys were read that way).
 */
const readDescriptorValue = (
  interpreter: Interpreter,
  target: StaticValue,
  descriptor: StaticObjectValue,
  key: string,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const keys = getKnownObjectKeys(descriptor);
  if (keys?.includes("value")) return getObjectProperty(descriptor, "value");
  if (keys?.includes("get")) {
    return interpreter.callValue(getObjectProperty(descriptor, "get"), [], context, location, {
      thisValue: target,
    });
  }
  return unknownValue(`property "${key}" defined with a dynamic descriptor`, location);
};

/** `Object.defineProperty`; a function's `name` is what fibers display. */
const defineOwnProperty = (
  interpreter: Interpreter,
  target: StaticValue,
  key: string,
  descriptor: StaticObjectValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): void => {
  const value = readDescriptorValue(interpreter, target, descriptor, key, context, location);
  switch (target.kind) {
    case "object":
      target.entries.push({ kind: "property", key, value });
      return;
    case "function":
    case "class":
      if (key === "name") {
        if (value.kind === "primitive" && typeof value.value === "string")
          target.name = value.value;
        return;
      }
      target.properties.set(key, value);
      return;
    default:
      return;
  }
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
    case "RegExp": {
      if (second !== undefined && second.kind !== "primitive")
        return unknownValue("RegExp with dynamic flags", location);
      const flags = second?.value === undefined ? null : String(second.value);
      if (first?.kind === "regexp") {
        return { ...first, flags: flags ?? first.flags, lastIndex: 0 };
      }
      if (first?.kind === "primitive") {
        return { kind: "regexp", pattern: String(first.value), flags: flags ?? "", lastIndex: 0 };
      }
      return unknownValue("RegExp from a dynamic pattern", location);
    }
    case "Proxy":
      return isConstructor && first && second?.kind === "object"
        ? { kind: "proxy", target: first, handler: second }
        : unknownValue("Proxy without a static handler", location);
    case "Promise":
      return createPromiseValue(
        first,
        (executor, executorArgs) =>
          interpreter.callValue(executor, executorArgs, context, location),
        location,
      );
    case "Symbol.for":
      return first?.kind === "primitive" && typeof first.value === "string"
        ? { kind: "symbol", key: first.value }
        : unknownValue("Symbol.for with a dynamic key", location);
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
      if (first?.kind === "function" || first?.kind === "class") {
        for (const source of args.slice(1)) {
          if (source.kind !== "object") continue;
          for (const key of getKnownObjectKeys(source) ?? []) {
            first.properties.set(key, getObjectProperty(source, key));
          }
        }
        return first;
      }
      if (first && first.kind !== "object" && first.kind !== "unknown" && first.kind !== "branch")
        return first;
      return objectValue(args.map((argument) => ({ kind: "spread", value: argument })));
    case "Object.freeze":
    case "Object.seal":
      return first ?? UNDEFINED_VALUE;
    case "Object.defineProperty": {
      const descriptor = args[2];
      if (!first || second?.kind !== "primitive" || descriptor?.kind !== "object") {
        return first ?? unknownValue("Object.defineProperty on a dynamic target", location);
      }
      if (first.kind === "object") interpreter.recordHeapMutation(first);
      defineOwnProperty(interpreter, first, String(second.value), descriptor, context, location);
      return first;
    }
    case "Object.defineProperties": {
      if (!first || second?.kind !== "object") {
        return first ?? unknownValue("Object.defineProperties on a dynamic target", location);
      }
      for (const key of getKnownObjectKeys(second) ?? []) {
        const descriptor = getObjectProperty(second, key);
        if (descriptor.kind === "object") {
          defineOwnProperty(interpreter, first, key, descriptor, context, location);
        }
      }
      return first;
    }
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

/** Truthiness of `predicate(item, index, list)` per item; null where the analysis cannot decide. */
const testItems = (
  interpreter: Interpreter,
  list: StaticListValue,
  predicate: CallableValue,
  context: EvaluationContext,
): (boolean | null)[] =>
  list.items.map((item, index) =>
    getTruthiness(
      callCallback(interpreter, predicate, [item, primitiveValue(index), list], context),
    ),
  );

const callCallback = (
  interpreter: Interpreter,
  callback: CallableValue,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue => interpreter.callValue(callback, args, context, null);

/** A callback run for an item that may occur zero or many times: its side effects are uncertain. */
export const callUncertainCallback = (
  interpreter: Interpreter,
  callback: CallableValue,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue =>
  callCallback(interpreter, callback, args, {
    ...context,
    uncertainDepth: context.uncertainDepth + 1,
  });

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
            item: callUncertainCallback(
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
            callUncertainCallback(
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
      item: callUncertainCallback(
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
    item: callUncertainCallback(
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

const listOfStrings = (parts: (string | undefined)[]): StaticListValue =>
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

const callNumberMethod = (
  receiver: number | boolean | bigint,
  name: string,
  args: StaticValue[],
): StaticValue | null => {
  const [first] = args;
  if (first !== undefined && first.kind !== "primitive") return null;
  const digits = first === undefined ? undefined : Number(first.value);
  switch (name) {
    case "toString":
      return primitiveValue(
        typeof receiver === "boolean" ? receiver.toString() : receiver.toString(digits),
      );
    case "valueOf":
      return primitiveValue(receiver);
    case "toFixed":
      return typeof receiver === "number" ? primitiveValue(receiver.toFixed(digits)) : null;
    case "toPrecision":
      return typeof receiver === "number" ? primitiveValue(receiver.toPrecision(digits)) : null;
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
  regExp.lastIndex = receiver.lastIndex;
  const matched = regExp.exec(input);
  receiver.lastIndex = regExp.lastIndex;
  if (name === "test") return primitiveValue(matched !== null);
  if (!matched) return NULL_VALUE;
  return {
    ...listOfStrings([...matched]),
    properties: new Map([
      ["index", primitiveValue(matched.index)],
      ["input", primitiveValue(input)],
    ]),
  };
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

  if (
    receiver.kind === "object" &&
    (name === "hasOwnProperty" || name === "propertyIsEnumerable") &&
    first?.kind === "primitive"
  ) {
    const keys = getKnownObjectKeys(receiver);
    return keys
      ? primitiveValue(keys.includes(String(first.value)))
      : unknownPrimitiveValue("boolean", `${name} of an object with dynamic spreads`);
  }

  if (receiver.kind === "global") {
    if ((receiver.name === "window" || receiver.name === "globalThis") && name === "matchMedia")
      return mediaQueryListValue(first);
    const storageAreaName = getStorageAreaName(receiver.name);
    if (storageAreaName !== null) {
      const stored = callStorageMethod(
        interpreter.storageAreas[storageAreaName],
        storageAreaName,
        name,
        args,
        location,
      );
      if (stored) return stored;
    }
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

  if (receiver.kind === "react-api" || receiver.kind === "native-function") {
    if (name === "call") return interpreter.callValue(receiver, args.slice(1), context, location);
    if (name === "apply") {
      return interpreter.callValue(
        receiver,
        second?.kind === "list" ? second.items : [unknownValue("apply arguments")],
        context,
        location,
      );
    }
    if (name === "bind") return receiver;
  }

  if (receiver.kind === "primitive") {
    const computed =
      typeof receiver.value === "string"
        ? callStringMethod(interpreter, receiver.value, name, args, context)
        : typeof receiver.value === "number" ||
            typeof receiver.value === "boolean" ||
            typeof receiver.value === "bigint"
          ? callNumberMethod(receiver.value, name, args)
          : null;
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
        if (item.kind === "repeat" || item.kind === "optional") {
          callUncertainCallback(
            interpreter,
            first,
            [
              item.kind === "repeat" ? item.item : item.value,
              unknownPrimitiveValue("number", "index"),
              receiver,
            ],
            context,
          );
        } else callCallback(interpreter, first, [item, primitiveValue(index), receiver], context);
      });
    } else if (receiver.kind === "repeat") {
      callUncertainCallback(
        interpreter,
        first,
        [receiver.item, unknownPrimitiveValue("number", "index"), receiver],
        context,
      );
    }
    return UNDEFINED_VALUE;
  }

  if (name === "flatMap" && isCallable(first)) {
    const mapped = mapList(interpreter, receiver, first, context);
    if (mapped.kind === "list") {
      return listValue(mapped.items.flatMap((item) => flattenOneLevel(item, location)));
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
        return listValue([
          ...receiver.items,
          ...args.flatMap((argument) => flattenOneLevel(argument, location)),
        ]);
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
      case "includes":
      case "indexOf": {
        if (!first || !hasDefiniteItems(receiver)) break;
        const verdicts = receiver.items.map((item) => compareIdentity(item, first));
        const foundIndex = verdicts.indexOf(true);
        if (
          foundIndex !== -1 &&
          verdicts.slice(0, foundIndex).every((verdict) => verdict === false)
        ) {
          return name === "includes" ? TRUE_VALUE : primitiveValue(foundIndex);
        }
        if (verdicts.every((verdict) => verdict === false)) {
          return name === "includes" ? FALSE_VALUE : primitiveValue(-1);
        }
        break;
      }
      case "some":
      case "every": {
        if (!isCallable(first) || !hasDefiniteItems(receiver)) break;
        const isSome = name === "some";
        const verdicts = testItems(interpreter, receiver, first, context);
        if (verdicts.some((verdict) => verdict === isSome))
          return isSome ? TRUE_VALUE : FALSE_VALUE;
        if (verdicts.every((verdict) => verdict !== null)) return isSome ? FALSE_VALUE : TRUE_VALUE;
        return unknownPrimitiveValue("boolean", `${name}() with an uncertain predicate`);
      }
      case "find":
      case "findLast":
      case "findIndex":
      case "findLastIndex": {
        const isIndex = name.endsWith("Index");
        const missing = isIndex ? primitiveValue(-1) : UNDEFINED_VALUE;
        if (!isCallable(first) || !hasDefiniteItems(receiver)) {
          if (isIndex) break;
          const candidates = receiver.items.filter((item) => item.kind !== "repeat");
          return branchValue([...candidates, missing], `${name}()`, location);
        }
        const verdicts = testItems(interpreter, receiver, first, context);
        const order = name.includes("Last")
          ? verdicts.map((_, index) => verdicts.length - 1 - index)
          : verdicts.map((_, index) => index);
        const candidates: StaticValue[] = [];
        for (const index of order) {
          if (verdicts[index] === false) continue;
          candidates.push(isIndex ? primitiveValue(index) : receiver.items[index]);
          if (verdicts[index] === true) return branchValue(candidates, `${name}()`, location);
        }
        return branchValue([...candidates, missing], `${name}()`, location);
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
        interpreter.recordHeapMutation(receiver);
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

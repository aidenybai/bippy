import type { StaticClassValue, StaticValue } from "../types.js";
import { getCollectionKind } from "./collections.js";
import { getErrorWitness } from "./errors.js";
import { isSearchParamsValue } from "./url-search-params.js";
import { getObjectProperty } from "./values.js";

type BuiltinConstructor = abstract new (...args: never[]) => unknown;

const BUILTIN_CONSTRUCTORS: Record<string, BuiltinConstructor> = {
  Object,
  Function,
  Array,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Date,
  RegExp,
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  ReferenceError,
  EvalError,
  URIError,
  Promise,
  String,
  Number,
  Boolean,
  Headers,
  Request,
  Response,
  FormData,
  Blob,
  URL,
  URLSearchParams,
  AbortController,
  AbortSignal,
  Event,
  EventTarget,
  TextEncoder,
  TextDecoder,
  ArrayBuffer,
  DataView,
  Uint8Array,
};

const COLLECTION_WITNESSES: Record<string, object> = {
  Map: new Map(),
  Set: new Set(),
  WeakMap: new WeakMap(),
  WeakSet: new WeakSet(),
};

/**
 * A runtime value with the same prototype chain as the static one, or null
 * when the chain is not known (class instances with unresolved bases, proxies
 * trapping `getPrototypeOf`, values the analysis cannot see).
 */
const getPrototypeWitness = (value: StaticValue): object | null => {
  switch (value.kind) {
    case "list":
      return [];
    case "object": {
      const collectionKind = getCollectionKind(value);
      if (collectionKind !== null) return COLLECTION_WITNESSES[collectionKind];
      if (isSearchParamsValue(value)) return new URLSearchParams();
      const errorWitness = getErrorWitness(value);
      if (errorWitness) return errorWitness;
      return value.entries.every(
        (entry) => entry.kind === "property" && entry.value.kind !== "native-function",
      )
        ? {}
        : null;
    }
    case "element":
      return {};
    case "regexp":
      return /witness/;
    case "native-object":
      return value.value;
    case "function":
    case "class":
    case "native-function":
    case "method":
      return () => undefined;
    case "proxy": {
      const trap = getObjectProperty(value.handler, "getPrototypeOf");
      return trap.kind === "primitive" && trap.value === undefined
        ? getPrototypeWitness(value.target)
        : null;
    }
    default:
      return null;
  }
};

const isPrimitiveLike = (value: StaticValue): boolean =>
  value.kind === "primitive" ||
  value.kind === "symbol" ||
  (value.kind === "unknown-primitive" && value.primitiveType !== "any");

/** Whether `classValue` is in the class chain of `left`'s constructor; null once the chain leaves analyzed code. */
const isInstanceOfClass = (left: StaticValue, classValue: StaticClassValue): boolean | null => {
  if (isPrimitiveLike(left)) return false;
  if (left.kind !== "object") return getPrototypeWitness(left) === null ? null : false;
  if (!left.constructedBy) return getPrototypeWitness(left) === null ? null : false;
  let current: StaticValue = left.constructedBy;
  while (current.kind === "class") {
    if (current === classValue) return true;
    const superValue: StaticValue | null = current.body.superValue;
    if (!superValue) return false;
    current = superValue;
  }
  return null;
};

/** `left instanceof right` for a built-in or analyzed constructor; null when it depends on values the analysis cannot see. */
export const isInstanceOf = (left: StaticValue, right: StaticValue): boolean | null => {
  if (right.kind === "class") return isInstanceOfClass(left, right);
  if (right.kind !== "global") return null;
  const constructor = BUILTIN_CONSTRUCTORS[right.name];
  if (!constructor) return null;
  if (isPrimitiveLike(left)) return false;
  const witness = getPrototypeWitness(left);
  return witness === null ? null : witness instanceof constructor;
};

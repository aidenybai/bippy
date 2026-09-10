import type { StaticClassValue, StaticFunctionValue, StaticValue } from "../types.js";
import { EVALUATOR_HOST_PLATFORM, loadHostRealm } from "../host/host-realm.js";
import { GLOBAL_INTERFACE_NAME } from "../host/realm-table.js";
import { getAbortWitness } from "./abort-controller.js";
import { isBlobValue } from "./blob.js";
import { getPrototypeOwner } from "./class-component.js";
import { isClockDateValue } from "./clock-date.js";
import { getCollectionKind } from "./collections.js";
import { getErrorWitness } from "./errors.js";
import { isObjectLike } from "./host-globals.js";
import { isNativeInstanceOf } from "./native-values.js";
import { getModeledPromise } from "./promises.js";
import { getBinaryWitness } from "./typed-arrays.js";
import { isSearchParamsValue } from "./url-search-params.js";
import { isUrlValue } from "./url.js";
import { getObjectProperty } from "./values.js";

/**
 * The object or function this process holds under a global name the analyzed
 * host shares with it: every language global (this process implements the same
 * language), and every constructor its own host declares too (`URL`, `Blob`,
 * `Event`), whose prototype chains the analysis builds its witnesses from. The
 * global object itself is the host's own, never this process's.
 */
const getSharedGlobal = (name: string): object | null => {
  if (name === GLOBAL_INTERFACE_NAME) return null;
  const value: unknown = Reflect.get(globalThis, name);
  if (!isObjectLike(value)) return null;
  if (loadHostRealm("ecmascript").hasGlobal(name)) return value;
  return typeof value === "function" && loadHostRealm(EVALUATOR_HOST_PLATFORM).hasGlobal(name)
    ? value
    : null;
};

/** The constructor this process implements under a shared global name, or null; `Function.prototype` itself is callable. */
export const getBuiltinConstructor = (name: string): Function | null => {
  const shared = getSharedGlobal(name);
  return typeof shared === "function" && isObjectLike(shared.prototype) ? shared : null;
};

/** The native prototype object a `<Constructor>.prototype` global denotes, or null for other names. */
const getBuiltinPrototype = (globalName: string): object | null => {
  const [constructorName = "", member, ...rest] = globalName.split(".");
  if (member !== "prototype" || rest.length > 0) return null;
  const prototype: unknown = getBuiltinConstructor(constructorName)?.prototype;
  return isObjectLike(prototype) ? prototype : null;
};

let builtinPrototypeNames: Map<object, string> | null = null;

const collectBuiltinPrototypeNames = (): Map<object, string> => {
  const names = new Map<object, string>();
  const globalNames = new Set([
    ...loadHostRealm("ecmascript").getGlobalNames(),
    ...loadHostRealm(EVALUATOR_HOST_PLATFORM).getGlobalNames(),
  ]);
  for (const name of globalNames) {
    const prototype = getBuiltinPrototype(`${name}.prototype`);
    if (prototype !== null && !names.has(prototype)) names.set(prototype, `${name}.prototype`);
  }
  return names;
};

/** The `<Constructor>.prototype` global name of a native prototype object, or null when it is not a shared builtin's. */
export const getBuiltinPrototypeName = (prototype: object): string | null => {
  builtinPrototypeNames ??= collectBuiltinPrototypeNames();
  return builtinPrototypeNames.get(prototype) ?? null;
};

const getMember = (current: unknown, member: string): unknown =>
  isObjectLike(current) ? Reflect.get(current, member) : undefined;

/** The native object or function a dotted builtin global such as `Object.prototype.hasOwnProperty` denotes, or null. */
export const getBuiltinWitness = (globalName: string): object | null => {
  const [rootName = "", ...members] = globalName.split(".");
  const witness = members.reduce<unknown>(getMember, getSharedGlobal(rootName));
  return isObjectLike(witness) ? witness : null;
};

/** `Function.prototype.toString` of the native function a dotted global such as `Object.prototype.hasOwnProperty` denotes, or null. */
export const getBuiltinFunctionSource = (globalName: string): string | null => {
  const witness = getBuiltinWitness(globalName);
  return typeof witness === "function" ? Function.prototype.toString.call(witness) : null;
};

const collectionWitnesses = new Map<string, object>();

/** An empty collection of the kind (`Map`, `WeakSet`), constructed once. */
const getCollectionWitness = (collectionKind: string): object | null => {
  const known = collectionWitnesses.get(collectionKind);
  if (known) return known;
  const constructor = getBuiltinConstructor(collectionKind);
  if (constructor === null) return null;
  const witness = Reflect.construct(constructor, []);
  collectionWitnesses.set(collectionKind, witness);
  return witness;
};

/**
 * A runtime value with the same prototype chain as the static one, or null
 * when the chain is not known (class instances with unresolved bases, proxies
 * trapping `getPrototypeOf`, values the analysis cannot see).
 */
export const getPrototypeWitness = (value: StaticValue): object | null => {
  switch (value.kind) {
    case "list":
      return getBinaryWitness(value) ?? [];
    case "object": {
      if (value.hasNullPrototype) return Object.create(null);
      const collectionKind = getCollectionKind(value);
      if (collectionKind !== null) return getCollectionWitness(collectionKind);
      if (isSearchParamsValue(value)) return new URLSearchParams();
      if (isUrlValue(value)) return new URL("http://witness.invalid");
      if (isClockDateValue(value)) return new Date(0);
      if (isBlobValue(value)) return new Blob();
      const errorWitness = getErrorWitness(value);
      if (errorWitness) return errorWitness;
      const abortWitness = getAbortWitness(value);
      if (abortWitness) return abortWitness;
      if (getModeledPromise(value)) return Promise.resolve();
      return value.entries.every(
        (entry) => entry.kind === "property" && entry.value.kind !== "native-function",
      )
        ? {}
        : null;
    }
    case "element":
      return {};
    case "namespace":
      return Object.create(null);
    case "regexp":
      return /witness/;
    case "native-object":
      return value.value;
    case "function":
    case "class":
    case "native-function":
    case "method":
      return () => undefined;
    case "global":
      return getBuiltinWitness(value.name);
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
  value.kind === "primitive" || value.kind === "symbol" || value.kind === "unknown-primitive";

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

/** Whether `fn.prototype` is on `left`'s explicit prototype chain; null once the chain reaches an object the analysis did not create. */
const isInstanceOfFunction = (left: StaticValue, fn: StaticFunctionValue): boolean | null => {
  if (isPrimitiveLike(left)) return false;
  if (left.kind !== "object") return getPrototypeWitness(left) === null ? null : false;
  const prototype = fn.properties.get("prototype");
  let current = left;
  while (current.prototype) {
    if (current.prototype === prototype) return true;
    current = current.prototype;
  }
  return current.constructedBy || getPrototypeWitness(current) === null ? null : false;
};

const FUNCTION_CHAIN_PROTOTYPES = new Set(["Function.prototype", "Object.prototype"]);

const isFunctionChainPrototype = (prototype: StaticValue): boolean =>
  prototype.kind === "global" && FUNCTION_CHAIN_PROTOTYPES.has(prototype.name);

const isSameConstructor = (left: StaticValue, right: StaticValue): boolean =>
  left === right ||
  (left.kind === "react-api" && right.kind === "react-api" && left.api === right.api) ||
  (left.kind === "global" && right.kind === "global" && left.name === right.name);

const isPrototypeOfWitness = (prototype: StaticValue, value: StaticValue): boolean | null => {
  const witness = getPrototypeWitness(value);
  if (witness === null) return null;
  if (prototype.kind !== "global") return false;
  const builtinPrototype = getBuiltinPrototype(prototype.name);
  return builtinPrototype === null ? null : builtinPrototype.isPrototypeOf(witness);
};

/** `prototype.isPrototypeOf(value)`; null once `value`'s chain reaches something the analysis did not create. */
export const isPrototypeOf = (prototype: StaticValue, value: StaticValue): boolean | null => {
  if (isPrimitiveLike(value)) return false;
  const owner = prototype.kind === "object" ? getPrototypeOwner(prototype) : null;
  if (owner) return isInstanceOfClass(value, owner);
  switch (value.kind) {
    case "function":
    case "native-function":
    case "method":
    case "react-api":
      return isFunctionChainPrototype(prototype);
    case "class": {
      let current: StaticValue = value;
      while (current.kind === "class") {
        const superValue: StaticValue | null = current.body.superValue;
        if (!superValue) return isFunctionChainPrototype(prototype);
        if (isSameConstructor(superValue, prototype)) return true;
        current = superValue;
      }
      return current.kind === "react-api" ? isFunctionChainPrototype(prototype) : null;
    }
    case "object": {
      let current = value;
      while (current.prototype) {
        if (current.prototype === prototype) return true;
        current = current.prototype;
      }
      return current.constructedBy ? null : isPrototypeOfWitness(prototype, current);
    }
    default:
      return isPrototypeOfWitness(prototype, value);
  }
};

/** `left instanceof right` for a built-in or analyzed constructor; null when it depends on values the analysis cannot see. */
export const isInstanceOf = (left: StaticValue, right: StaticValue): boolean | null => {
  if (right.kind === "class") return isInstanceOfClass(left, right);
  if (right.kind === "function") return isInstanceOfFunction(left, right);
  if (right.kind === "external") {
    if (right.origin !== "binding") return null;
    if (isPrimitiveLike(left)) return false;
    return left.kind === "external" &&
      left.origin === "instance" &&
      left.packageName === right.packageName &&
      left.importedName === `new ${right.importedName}`
      ? true
      : null;
  }
  if (right.kind !== "global") return null;
  if (left.kind === "native-object") {
    const native = isNativeInstanceOf(left, right.name);
    if (native !== null) return native;
  }
  const constructor = getBuiltinConstructor(right.name);
  if (constructor === null) return null;
  if (isPrimitiveLike(left)) return false;
  const witness = getPrototypeWitness(left);
  return witness === null ? null : witness instanceof constructor;
};

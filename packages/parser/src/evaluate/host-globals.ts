import type { StaticValue, UnknownPrimitiveType } from "../types.js";
import type { HostDocument } from "../host/host-document.js";
import { type HostRealm, loadHostRealm } from "../host/host-realm.js";
import { GLOBAL_INTERFACE_NAME, type HostValueKind } from "../host/realm-table.js";
import { getHostDocumentMember, getNativeInterfaceName } from "./native-values.js";
import {
  isSymbolPropertyKey,
  NULL_VALUE,
  primitiveValue,
  SYMBOL_PROPERTY_KEY_PREFIX,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export const GLOBAL_OBJECT_VALUE: StaticValue = { kind: "global", name: GLOBAL_INTERFACE_NAME };

export const isObjectLike = (value: unknown): value is object =>
  (typeof value === "object" || typeof value === "function") && value !== null;

const PRIMITIVE_KINDS = new Set<HostValueKind>(["string", "number", "boolean", "bigint"]);

/** One value of each primitive type, standing for all of them wherever only the type matters. */
const PRIMITIVE_WITNESSES: Record<string, string | number | boolean | bigint> = {
  string: "",
  number: 0,
  boolean: false,
  bigint: 0n,
};

/** A value of the primitive type (`typeof` name); undefined for `symbol` and non-primitives. */
export const getPrimitiveWitness = (
  primitiveType: string,
): string | number | boolean | bigint | undefined => PRIMITIVE_WITNESSES[primitiveType];

/** The interface the language wraps a primitive type's values in (`String` for strings), read off this process's own wrapper. */
const getPrimitiveInterfaceName = (primitiveType: string): string | undefined => {
  const witness = getPrimitiveWitness(primitiveType);
  return witness === undefined ? undefined : getNativeInterfaceName(Object(witness));
};

const isLanguageGlobal = (name: string, value: unknown): boolean =>
  loadHostRealm("ecmascript").hasGlobal(name) && Reflect.get(globalThis, name) === value;

/**
 * The canonical global path of a language object reached by another path, so
 * `Object.prototype.constructor` is `Object` and `Array.prototype.constructor.prototype`
 * is `Array.prototype`; null for objects only reachable by their own path.
 */
const getCanonicalLanguageGlobal = (value: object): StaticValue | null => {
  const ownName = Reflect.get(value, "name");
  if (typeof ownName === "string" && isLanguageGlobal(ownName, value))
    return { kind: "global", name: ownName };
  const constructor = Reflect.get(value, "constructor");
  if (
    typeof constructor === "function" &&
    constructor.prototype === value &&
    isLanguageGlobal(constructor.name, constructor)
  )
    return { kind: "global", name: `${constructor.name}.prototype` };
  return null;
};

interface LanguagePathReading {
  readonly value: unknown;
}

/** What a dotted path starting at a language global holds in this process, which implements the same language; null when the path starts elsewhere or breaks off. */
const readLanguagePath = (name: string): LanguagePathReading | null => {
  const [root, ...keys] = name.split(".");
  if (root === undefined || !loadHostRealm("ecmascript").hasGlobal(root)) return null;
  let value: unknown = Reflect.get(globalThis, root);
  for (const key of keys) {
    if (!isObjectLike(value)) return null;
    value = Reflect.get(value, key);
  }
  return { value };
};

/** The object or function a dotted language path (`Object.defineProperty`, `Array.prototype`) denotes, or null. */
export const getLanguageObject = (name: string): object | null => {
  const reading = readLanguagePath(name);
  return reading !== null && isObjectLike(reading.value) ? reading.value : null;
};

/** The property key a static key (`length`, `@@Symbol.toStringTag`) denotes on a language object; null for symbols the program allocated. */
export const toLanguagePropertyKey = (key: string): string | symbol | null => {
  if (!isSymbolPropertyKey(key)) return key;
  const reading = readLanguagePath(key.slice(SYMBOL_PROPERTY_KEY_PREFIX.length));
  return typeof reading?.value === "symbol" ? reading.value : null;
};

/**
 * A language value (`Math.PI`, `Symbol.iterator`, `Object.prototype.constructor`)
 * read from this process: constants become primitives and objects resolve to
 * their canonical global. Null when the path starts outside the language or
 * names an object without a canonical path.
 */
const readLanguageValue = (name: string): StaticValue | null => {
  const reading = readLanguagePath(name);
  if (reading === null) return null;
  const { value } = reading;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "undefined":
      return primitiveValue(value);
    case "symbol":
      return { kind: "symbol", key: name };
    case "object":
    case "function":
      return value === null ? NULL_VALUE : getCanonicalLanguageGlobal(value);
  }
};

/** Listeners escape instead of running inline, so no event is ever being dispatched while the interpreter evaluates. */
const DISPATCH_STATE_GLOBALS = new Map<string, StaticValue>([["event", UNDEFINED_VALUE]]);

const toUnknownPrimitiveType = (kind: HostValueKind): UnknownPrimitiveType =>
  kind === "string" || kind === "number" || kind === "boolean" ? kind : "any";

/**
 * The value a global by dotted path holds in this host, from its declarations:
 * aliases of the global object collapse to it, constants read from the
 * language, functions become callable globals by their dotted name, and
 * anything the declarations leave open stays unknown. Null when undeclared.
 */
export const getHostGlobal = (
  realm: HostRealm,
  hostDocument: HostDocument | null,
  name: string,
): StaticValue | null => {
  const normalized = realm.normalizeGlobalName(name);
  const languageValue = readLanguageValue(normalized);
  if (languageValue?.kind === "global") return languageValue;
  const member = realm.getGlobal(normalized);
  if (member === null) return null;
  if (realm.isGlobalObjectType(member.type)) return GLOBAL_OBJECT_VALUE;
  const dispatchState = DISPATCH_STATE_GLOBALS.get(normalized);
  if (dispatchState) return dispatchState;
  const separator = normalized.lastIndexOf(".");
  const objectPath = separator === -1 ? "" : normalized.slice(0, separator);
  const memberName = normalized.slice(separator + 1);
  if (hostDocument !== null) {
    const native = getHostDocumentMember(hostDocument, objectPath, memberName);
    if (native) return native;
  }
  const kind = realm.getTypeKind(member.type);
  if (member.type.isNullable && kind !== "undefined" && kind !== "null")
    return unknownValue(normalized);
  switch (kind) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return languageValue ?? unknownPrimitiveValue(toUnknownPrimitiveType(kind), normalized);
    case "symbol":
      return languageValue ?? { kind: "symbol", key: normalized };
    case "undefined":
      return UNDEFINED_VALUE;
    case "null":
      return NULL_VALUE;
    case "any":
      return unknownValue(normalized);
    case "function":
    case "object":
      return { kind: "global", name: normalized };
  }
};

/** `typeof` of a declared global; null when declarations leave it open (`any`, nullable). */
export const getHostGlobalTypeof = (realm: HostRealm, name: string): string | null =>
  realm.getGlobalTypeof(realm.normalizeGlobalName(name));

/**
 * What a method of this name returns when its receiver is opaque: the return
 * type the language declares for it, when every language interface agrees; a
 * receiver known to be a primitive narrows to that primitive's own methods.
 */
export const getLanguageMethodResult = (
  receiver: StaticValue,
  methodName: string,
): StaticValue | null => {
  const language = loadHostRealm("ecmascript");
  const receiverInterface =
    receiver.kind === "unknown-primitive"
      ? getPrimitiveInterfaceName(receiver.primitiveType)
      : receiver.kind === "primitive"
        ? getPrimitiveInterfaceName(typeof receiver.value)
        : undefined;
  const returnKind =
    receiverInterface === undefined
      ? language.getMemberReturnKind(methodName)
      : getDeclaredReturnKind(language, receiverInterface, methodName);
  if (returnKind === null || !PRIMITIVE_KINDS.has(returnKind)) return null;
  return unknownPrimitiveValue(toUnknownPrimitiveType(returnKind), `${methodName}()`);
};

const getDeclaredReturnKind = (
  realm: HostRealm,
  interfaceName: string,
  methodName: string,
): HostValueKind | null => {
  const member = realm.getMember(interfaceName, methodName);
  if (member === null || member.type.kind !== "function" || member.returnType === null) return null;
  return member.returnType.kind === "any" || member.returnType.isNullable
    ? null
    : realm.getTypeKind(member.returnType);
};

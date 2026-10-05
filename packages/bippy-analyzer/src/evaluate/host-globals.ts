import type { HostDocument } from "../host/host-document.js";
import { type HostRealm, loadHostRealm } from "../host/host-realm.js";
import { GLOBAL_INTERFACE_NAME, type HostType, type HostValueKind } from "../host/realm-table.js";
import type { SourceLocation } from "../parse/source-types.js";
import type { StaticObjectValue, StaticValue, UnknownPrimitiveType } from "../types.js";
import { readLanguageValue } from "./language-intrinsics.js";
import { getHostDocumentMember, getNativeInterfaceName } from "./native-values.js";
import { escapedPromiseValue } from "./promises.js";
import { nativeFunction } from "./stubs.js";
import {
  NULL_VALUE,
  objectValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export const GLOBAL_OBJECT_VALUE: StaticValue = { kind: "global", name: GLOBAL_INTERFACE_NAME };

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

/** Listeners escape instead of running inline, so no event is ever being dispatched while the interpreter evaluates. */
const DISPATCH_STATE_GLOBALS = new Map<string, StaticValue>([["event", UNDEFINED_VALUE]]);

const toUnknownPrimitiveType = (kind: HostValueKind): UnknownPrimitiveType =>
  kind === "string" || kind === "number" || kind === "boolean" ? kind : "any";

const getDeclaredHostValue = (
  realm: HostRealm,
  type: HostType,
  reason: string,
  location: SourceLocation | null,
): StaticValue => {
  if (type.isNullable || type.kind === "any") return unknownValue(reason, location);
  switch (realm.getTypeKind(type)) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return unknownPrimitiveValue(toUnknownPrimitiveType(type.kind), reason);
    case "symbol":
      return unknownValue(reason, location);
    case "undefined":
      return UNDEFINED_VALUE;
    case "null":
      return NULL_VALUE;
    case "function":
      return nativeFunction(reason, (args, tools) => {
        for (const argument of args) tools.markEscaped(argument);
        return unknownValue(`${reason}()`, location);
      });
    case "object":
      if (type.interfaceName === "Promise") return escapedPromiseValue();
      return type.interfaceName === null
        ? unknownValue(reason, location)
        : { ...objectValue(), hostInterfaceName: type.interfaceName };
    case "any":
      return unknownValue(reason, location);
  }
};

export const constructDeclaredHostObject = (
  realm: HostRealm,
  name: string,
  location: SourceLocation | null,
): StaticValue | null => {
  const instanceType = realm.getGlobal(`${name}.prototype`)?.type;
  return instanceType?.kind === "object" && instanceType.interfaceName !== null
    ? getDeclaredHostValue(realm, instanceType, `new ${name}()`, location)
    : null;
};

export const getDeclaredHostObjectMember = (
  realm: HostRealm,
  object: StaticObjectValue,
  key: string,
  location: SourceLocation | null,
): StaticValue | null => {
  if (object.hostInterfaceName === undefined) return null;
  const member = realm.getMember(object.hostInterfaceName, key);
  if (member === null) return null;
  const reason = `${object.hostInterfaceName}.${key}`;
  if (member.type.kind !== "function") {
    return getDeclaredHostValue(realm, member.type, reason, location);
  }
  return nativeFunction(reason, (args, tools) => {
    for (const argument of args) tools.markEscaped(argument);
    return member.returnType === null
      ? unknownValue(`${reason}()`, location)
      : getDeclaredHostValue(realm, member.returnType, `${reason}()`, location);
  });
};

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

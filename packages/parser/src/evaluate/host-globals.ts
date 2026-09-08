import type { StaticValue, UnknownPrimitiveType } from "../types.js";
import type { HostDocument } from "../host/host-document.js";
import { type HostRealm, loadHostRealm } from "../host/host-realm.js";
import { GLOBAL_INTERFACE_NAME, type HostValueKind } from "../host/realm-table.js";
import { getHostDocumentMember } from "./native-values.js";
import {
  NULL_VALUE,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export const GLOBAL_OBJECT_VALUE: StaticValue = { kind: "global", name: GLOBAL_INTERFACE_NAME };

const PRIMITIVE_KINDS = new Set<HostValueKind>(["string", "number", "boolean", "bigint"]);

const PRIMITIVE_INTERFACE_NAMES: Record<string, string> = {
  string: "String",
  number: "Number",
  boolean: "Boolean",
  bigint: "BigInt",
};

/** A language constant (`Math.PI`, `Number.MAX_SAFE_INTEGER`, `Symbol.iterator`) read from this process, which implements the same language. */
const readLanguageConstant = (name: string): StaticValue | null => {
  if (!loadHostRealm("ecmascript").hasGlobal(name)) return null;
  let value: unknown = globalThis;
  for (const key of name.split(".")) {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
    value = Reflect.get(value, key);
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "undefined":
      return primitiveValue(value);
    case "symbol":
      return { kind: "symbol", key: name };
    default:
      return value === null ? NULL_VALUE : null;
  }
};

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
  const member = realm.getGlobal(normalized);
  if (member === null) {
    const constructorRoot = normalized.replace(/\.prototype\.constructor$/, "");
    return constructorRoot !== normalized && realm.hasGlobal(`${constructorRoot}.prototype`)
      ? { kind: "global", name: constructorRoot }
      : null;
  }
  if (realm.isGlobalObjectType(member.type)) return GLOBAL_OBJECT_VALUE;
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
      return (
        readLanguageConstant(normalized) ??
        unknownPrimitiveValue(toUnknownPrimitiveType(kind), normalized)
      );
    case "symbol":
      return readLanguageConstant(normalized) ?? { kind: "symbol", key: normalized };
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
      ? PRIMITIVE_INTERFACE_NAMES[receiver.primitiveType]
      : receiver.kind === "primitive"
        ? PRIMITIVE_INTERFACE_NAMES[typeof receiver.value]
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

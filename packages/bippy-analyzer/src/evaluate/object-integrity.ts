import type { StaticListValue, StaticObjectValue, StaticValue } from "../types.js";
import {
  FALSE_VALUE,
  getObjectProperty,
  getOwnPropertyCandidates,
  getOwnPropertyDescriptor,
  getTruthiness,
  getTruthinessCases,
  hasDefiniteItems,
  hasOwnKey,
  isUndefinedValue,
  mapValue,
  primitiveValue,
  toIndexKey,
  TRUE_VALUE,
  unknownPrimitiveValue,
} from "./values.js";

interface IntegrityCarrier {
  integrity?: StaticValue;
}

export const getObjectExtensibility = (target: StaticObjectValue): StaticValue =>
  target.integrity
    ? mapValue(target.integrity, (level) =>
        level.kind === "primitive"
          ? primitiveValue(level.value === "extensible")
          : unknownPrimitiveValue("boolean", "object extensibility"),
      )
    : TRUE_VALUE;

export const getNextObjectIntegrity = (
  target: IntegrityCarrier,
  operation: "Object.freeze" | "Object.seal" | "Object.preventExtensions",
): StaticValue => {
  if (operation === "Object.freeze") return primitiveValue("frozen");
  return mapValue(target.integrity ?? primitiveValue("extensible"), (level) => {
    if (level.kind !== "primitive") return level;
    if (operation === "Object.seal")
      return primitiveValue(level.value === "frozen" ? "frozen" : "sealed");
    return level.value === "extensible" ? primitiveValue("non-extensible") : level;
  });
};

export const getObjectIntegrityTest = (
  target: StaticObjectValue,
  requiresFrozen: boolean,
): StaticValue => {
  if (!target.integrity) return FALSE_VALUE;
  return mapValue(target.integrity, (level) => {
    if (level.kind !== "primitive")
      return unknownPrimitiveValue("boolean", "unresolved object integrity");
    if (level.value === "extensible") return FALSE_VALUE;
    if (level.value === "frozen" || (level.value === "sealed" && !requiresFrozen))
      return TRUE_VALUE;
    return getPropertyIntegrity({ ...target, integrity: level }, requiresFrozen);
  });
};

const isIntegrityLevel = (
  integrity: StaticValue | undefined,
  level: "extensible" | "non-extensible" | "sealed" | "frozen",
): boolean => integrity?.kind === "primitive" && integrity.value === level;

const listOwnsData = (target: StaticListValue, key: string): boolean => {
  if (key === "length" || target.properties?.has(key)) return true;
  const index = toIndexKey(key);
  return index !== null && hasDefiniteItems(target) && index < target.items.length;
};

/** Index and named data stay writable until freeze. Node ignores length when testing frozen arrays. */
const hasWritableListData = (target: StaticListValue): boolean =>
  !hasDefiniteItems(target) ||
  target.items.length > 0 ||
  [...(target.properties?.keys() ?? [])].some((key) => key !== "length");

const hasConfigurableListData = (target: StaticListValue): boolean => hasWritableListData(target);

export const isListDefinitelyFrozen = (target: StaticListValue): boolean =>
  target.isFrozen === true || isIntegrityLevel(target.integrity, "frozen");

export const getListWritePermission = (target: StaticListValue, key: string): StaticValue => {
  if (target.integrity?.kind === "branch")
    return mapValue(target.integrity, (integrity) =>
      getListWritePermission({ ...target, integrity }, key),
    );
  if (isListDefinitelyFrozen(target)) return FALSE_VALUE;
  if (
    listOwnsData(target, key) ||
    !target.integrity ||
    isIntegrityLevel(target.integrity, "extensible")
  )
    return TRUE_VALUE;
  if (target.integrity.kind !== "primitive")
    return unknownPrimitiveValue("boolean", "unresolved list write");
  return FALSE_VALUE;
};

export const getListDeletePermission = (target: StaticListValue, key: string): StaticValue => {
  if (target.integrity?.kind === "branch")
    return mapValue(target.integrity, (integrity) =>
      getListDeletePermission({ ...target, integrity }, key),
    );
  if (!listOwnsData(target, key)) return TRUE_VALUE;
  if (
    key === "length" ||
    isListDefinitelyFrozen(target) ||
    isIntegrityLevel(target.integrity, "sealed")
  )
    return FALSE_VALUE;
  return TRUE_VALUE;
};

export const getListExtensibility = (target: StaticListValue): StaticValue => {
  if (!target.integrity) return TRUE_VALUE;
  if (target.integrity.kind === "branch")
    return mapValue(target.integrity, (integrity) =>
      getListExtensibility({ ...target, integrity }),
    );
  return target.integrity.kind === "primitive"
    ? primitiveValue(target.integrity.value === "extensible")
    : unknownPrimitiveValue("boolean", "object extensibility");
};

export const getListIntegrityTest = (
  target: StaticListValue,
  requiresFrozen: boolean,
): StaticValue => {
  if (!target.integrity) return primitiveValue(target.isFrozen === true && requiresFrozen);
  if (target.integrity.kind === "branch")
    return mapValue(target.integrity, (integrity) =>
      getListIntegrityTest({ ...target, integrity }, requiresFrozen),
    );
  if (target.integrity.kind !== "primitive")
    return unknownPrimitiveValue("boolean", "unresolved object integrity");
  if (isIntegrityLevel(target.integrity, "extensible")) return FALSE_VALUE;
  if (isIntegrityLevel(target.integrity, "frozen")) return TRUE_VALUE;
  if (!hasDefiniteItems(target))
    return unknownPrimitiveValue("boolean", "object integrity with unresolved keys");
  if (isIntegrityLevel(target.integrity, "sealed"))
    return primitiveValue(!requiresFrozen || !hasWritableListData(target));
  if (hasConfigurableListData(target)) return FALSE_VALUE;
  return primitiveValue(!requiresFrozen || !hasWritableListData(target));
};

const getPropertyIntegrity = (target: StaticObjectValue, requiresFrozen: boolean): StaticValue => {
  const keys = getOwnPropertyCandidates(target);
  if (!keys) return unknownPrimitiveValue("boolean", "object integrity with unresolved keys");
  let result: StaticValue = TRUE_VALUE;
  for (const key of keys) {
    const descriptor = getOwnPropertyDescriptor(target, key);
    if (!descriptor)
      return unknownPrimitiveValue("boolean", "object integrity with unresolved descriptors");
    const permission = mapValue(descriptor, (metadata) => {
      if (isUndefinedValue(metadata)) return TRUE_VALUE;
      if (metadata.kind !== "object")
        return unknownPrimitiveValue("boolean", "unresolved property integrity");
      return mapValue(
        getTruthinessCases(getObjectProperty(metadata, "configurable")),
        (configurable) => {
          if (getTruthiness(configurable) === true) return FALSE_VALUE;
          if (!requiresFrozen || hasOwnKey(metadata, "writable") !== true) return TRUE_VALUE;
          return mapValue(
            getTruthinessCases(getObjectProperty(metadata, "writable")),
            (writable) => (getTruthiness(writable) === true ? FALSE_VALUE : TRUE_VALUE),
          );
        },
      );
    });
    result = mapValue(getTruthinessCases(result), (current) =>
      getTruthiness(current) === true ? permission : FALSE_VALUE,
    );
  }
  return result;
};

import type { StaticObjectValue, StaticValue } from "../types.js";
import {
  FALSE_VALUE,
  getObjectProperty,
  getOwnPropertyCandidates,
  getOwnPropertyDescriptor,
  getTruthiness,
  getTruthinessCases,
  hasOwnKey,
  isUndefinedValue,
  mapValue,
  primitiveValue,
  TRUE_VALUE,
  unknownPrimitiveValue,
} from "./values.js";

export const getObjectExtensibility = (target: StaticObjectValue): StaticValue =>
  target.integrity
    ? mapValue(target.integrity, (level) =>
        level.kind === "primitive"
          ? primitiveValue(level.value === "extensible")
          : unknownPrimitiveValue("boolean", "object extensibility"),
      )
    : TRUE_VALUE;

export const getNextObjectIntegrity = (
  target: StaticObjectValue,
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

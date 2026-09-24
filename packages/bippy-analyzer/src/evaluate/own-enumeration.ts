import type { SourceLocation } from "../parse/source-types.js";
import type { StaticObjectValue, StaticValue } from "../types.js";
import type { EvaluationContext, PropertyReader, ValueContinuationEvaluator } from "./context.js";
import {
  distributeObjectBranches,
  getObjectProperty,
  getKnownOwnKeys,
  getOwnPropertyCandidates,
  getOwnPropertyDescriptor,
  getPropertyKeyValue,
  getPropertyName,
  getTruthiness,
  getTruthinessCases,
  isSymbolPropertyKey,
  isUndefinedValue,
  listValue,
  mapValue,
  objectValue,
  TRUE_VALUE,
  unknownValue,
} from "./values.js";

export interface OwnEnumerationEvaluator extends ValueContinuationEvaluator, PropertyReader {}

const hasKeyAlternatives = (value: StaticValue, visited = new Set<StaticValue>()): boolean => {
  if (value.kind === "branch") return true;
  if (value.kind !== "object" || visited.has(value)) return false;
  visited.add(value);
  return value.entries.some(
    (entry) => entry.kind === "spread" && hasKeyAlternatives(entry.value, visited),
  );
};

export const enumerateOwnObject = (
  evaluator: OwnEnumerationEvaluator,
  target: StaticObjectValue,
  operation:
    | "Object.keys"
    | "Object.values"
    | "Object.entries"
    | "Object.getOwnPropertyNames"
    | "Object.getOwnPropertySymbols"
    | "Reflect.ownKeys"
    | "CopyDataProperties",
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  if (!getOwnPropertyCandidates(target)) return null;
  const hasAlternatives = hasKeyAlternatives(target);
  const shapes = hasAlternatives ? distributeObjectBranches(target) : target;
  if (hasAlternatives && shapes === target)
    return unknownValue(`${operation} exceeds the property-order bound`, location);
  return evaluator.continueValue(shapes, context, (shape, shapeContext) => {
    const candidates = shape.kind === "object" ? getOwnPropertyCandidates(shape) : null;
    if (!candidates || hasKeyAlternatives(shape))
      return unknownValue(`${operation} with unresolved property order`, location);
    const isCopy = operation === "CopyDataProperties";
    const hasValues = operation === "Object.values" || operation === "Object.entries" || isCopy;
    const requiresEnumerable = hasValues || operation === "Object.keys";
    const includesSymbols =
      operation === "Object.getOwnPropertySymbols" || operation === "Reflect.ownKeys" || isCopy;
    const includesStrings = operation !== "Object.getOwnPropertySymbols";
    let result: StaticValue = listValue([]);
    for (const key of candidates) {
      if (isSymbolPropertyKey(key) ? !includesSymbols : !includesStrings) continue;
      result = evaluator.continueValue(result, shapeContext, (collected, collectedContext) => {
        if (collected.kind !== "list") return collected;
        const descriptor = getOwnPropertyDescriptor(target, key);
        if (!descriptor)
          return unknownValue(`${operation} with an unresolved descriptor`, location);
        return evaluator.continueValue(
          descriptor,
          collectedContext,
          (metadata, metadataContext) => {
            if (metadata.kind !== "object")
              return isUndefinedValue(metadata)
                ? collected
                : unknownValue(`${operation} with an unresolved descriptor`, location);
            const enumerable = requiresEnumerable
              ? getObjectProperty(metadata, "enumerable")
              : TRUE_VALUE;
            return evaluator.continueValue(
              getTruthinessCases(enumerable),
              metadataContext,
              (selected, selectedContext) => {
                if (getTruthiness(selected) !== true) return collected;
                const propertyKey = getPropertyKeyValue(key);
                if (!hasValues) return listValue([...collected.items, propertyKey]);
                return evaluator.continueValue(
                  evaluator.getProperty(target, key, selectedContext, location),
                  selectedContext,
                  (value) =>
                    listValue([
                      ...collected.items,
                      operation === "Object.values" ? value : listValue([propertyKey, value]),
                    ]),
                );
              },
            );
          },
        );
      });
    }
    return result;
  });
};

export const getNeedsSpreadExecution = (value: StaticValue): boolean =>
  value.kind === "branch" ||
  (value.kind === "object" &&
    (value.entries.some((entry) => entry.kind === "spread" || entry.accessor) ||
      !getKnownOwnKeys(value, () => true)));

export const getObjectSpreadSnapshot = (
  evaluator: OwnEnumerationEvaluator,
  target: StaticObjectValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  const entries = enumerateOwnObject(evaluator, target, "CopyDataProperties", context, location);
  if (!entries) return null;
  return mapValue(entries, (alternative) => {
    if (alternative.kind !== "list") return alternative;
    const snapshot = objectValue([]);
    for (const entry of alternative.items) {
      if (entry.kind !== "list" || entry.items.length !== 2)
        return unknownValue("unresolved object spread entry", location);
      const [propertyKey, value] = entry.items;
      const key = getPropertyName(propertyKey);
      if (key === null) return unknownValue("unresolved object spread key", location);
      snapshot.entries.push({ kind: "property", key, value });
    }
    return snapshot;
  });
};

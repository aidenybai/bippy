import type { SourceLocation } from "../parse/source-types.js";
import type { StaticObjectValue, StaticValue } from "../types.js";
import type { EvaluationContext, PropertyAssigner } from "./context.js";
import { enumerateOwnObject, type OwnEnumerationEvaluator } from "./own-enumeration.js";
import {
  getObjectProperty,
  getOwnPropertyDescriptor,
  getPropertyName,
  getTruthiness,
  getTruthinessCases,
  isUndefinedValue,
  unknownValue,
} from "./values.js";

interface ObjectCopyEvaluator extends OwnEnumerationEvaluator, PropertyAssigner {}

export const assignObjectSource = (
  evaluator: ObjectCopyEvaluator,
  target: StaticValue,
  source: StaticObjectValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  const keys = enumerateOwnObject(evaluator, source, "Reflect.ownKeys", context, location);
  if (!keys) return null;
  return evaluator.continueValue(keys, context, (keyList, keyContext) => {
    if (keyList.kind !== "list") return keyList;
    let result = target;
    for (const propertyKey of keyList.items) {
      const key = getPropertyName(propertyKey);
      if (key === null) return unknownValue("Object.assign with an unresolved key", location);
      result = evaluator.continueValue(result, keyContext, (receiver, receiverContext) => {
        const descriptor = getOwnPropertyDescriptor(source, key);
        if (!descriptor)
          return unknownValue("Object.assign with an unresolved descriptor", location);
        return evaluator.continueValue(descriptor, receiverContext, (metadata, metadataContext) => {
          if (isUndefinedValue(metadata)) return receiver;
          if (metadata.kind !== "object")
            return unknownValue("Object.assign with an unresolved descriptor", location);
          return evaluator.continueValue(
            getTruthinessCases(getObjectProperty(metadata, "enumerable")),
            metadataContext,
            (enumerable, enumerableContext) => {
              if (getTruthiness(enumerable) !== true) return receiver;
              return evaluator.continueValue(
                evaluator.getProperty(source, key, enumerableContext, location),
                enumerableContext,
                (value, valueContext) =>
                  evaluator.assignProperty(receiver, key, value, valueContext, { isStrict: true }),
              );
            },
          );
        });
      });
    }
    return result;
  });
};

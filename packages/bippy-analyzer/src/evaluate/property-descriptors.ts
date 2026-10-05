import type { HostRealm } from "../host/host-realm.js";
import type { SourceLocation } from "../parse/source-types.js";
import type {
  RenderEnvironment,
  StaticObjectValue,
  StaticPropertyEntry,
  StaticValue,
} from "../types.js";
import type { EvaluationContext, PropertyReader, ValueContinuationEvaluator } from "./context.js";
import { createErrorValue } from "./errors.js";
import { applyBinaryOperator } from "./operators.js";
import { getObjectExtensibility } from "./object-integrity.js";
import { getTruthinessPredicate } from "./predicates.js";
import { getTypeofValue } from "./value-typeof.js";
import {
  accessorEntry,
  branchValue,
  distributeBinary,
  FALSE_VALUE,
  getKnownOwnKeys,
  getObjectProperty,
  getOwnPropertyDescriptor,
  getOwnPropertyEntry,
  getSameValueComparison,
  getTruthiness,
  isUndefinedValue,
  mapValue,
  objectValue,
  primitiveValue,
  toBooleanValue,
  thrownValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
} from "./values.js";

export interface PropertyDescriptorEvaluator extends ValueContinuationEvaluator, PropertyReader {
  getRealm: (environment: RenderEnvironment | null) => HostRealm;
  getHasProperty: (
    target: StaticValue,
    key: StaticValue,
    context: EvaluationContext,
    location: SourceLocation | null,
  ) => StaticValue;
}

export interface PropertyDefinition {
  entry: StaticPropertyEntry;
  permission: StaticValue;
}

const getConditionalValue = (
  condition: StaticValue,
  whenTrue: StaticValue,
  whenFalse: StaticValue,
): StaticValue => {
  const truthiness = getTruthiness(condition);
  if (truthiness !== null) return truthiness ? whenTrue : whenFalse;
  return branchValue(
    [whenTrue, whenFalse],
    "property descriptor condition",
    null,
    0,
    getTruthinessPredicate(condition),
  );
};

const getConjunction = (conditions: StaticValue[]): StaticValue =>
  conditions.reduce(
    (previous, condition) => getConditionalValue(condition, previous, FALSE_VALUE),
    TRUE_VALUE,
  );

const getSameValueCondition = (left: StaticValue, right: StaticValue): StaticValue =>
  distributeBinary(left, right, getSameValueComparison) ?? getSameValueComparison(left, right);

const getDescriptorError = (reason: string, location: SourceLocation | null): StaticValue =>
  thrownValue(reason, createErrorValue("TypeError", [primitiveValue(reason)], location), location);

export const readPropertyDescriptor = (
  evaluator: PropertyDescriptorEvaluator,
  descriptor: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue =>
  evaluator.continueValue(descriptor, context, (source, sourceContext) => {
    if (source.kind === "primitive" || source.kind === "symbol")
      return getDescriptorError("Property description must be an object", location);
    let result: StaticValue = objectValue();
    for (const name of ["enumerable", "configurable", "value", "writable", "get", "set"]) {
      result = evaluator.continueValue(result, sourceContext, (collected, fieldContext) => {
        if (collected.kind !== "object") return collected;
        const presence = evaluator.getHasProperty(
          source,
          primitiveValue(name),
          fieldContext,
          location,
        );
        return evaluator.continueValue(presence, fieldContext, (presenceValue, presenceContext) =>
          evaluator.continueValue(
            getConditionalValue(presenceValue, TRUE_VALUE, FALSE_VALUE),
            presenceContext,
            (present, presentContext) => {
              if (getTruthiness(present) === false) return collected;
              return evaluator.continueValue(
                evaluator.getProperty(source, name, presentContext, location),
                presentContext,
                (value, valueContext) => {
                  const append = (field: StaticValue): StaticValue =>
                    objectValue([
                      ...collected.entries,
                      { kind: "property", key: name, value: field },
                    ]);
                  if (name === "enumerable" || name === "configurable" || name === "writable")
                    return append(toBooleanValue(value));
                  if (name === "value") return append(value);
                  const methodType = getTypeofValue(
                    value,
                    evaluator.getRealm(valueContext.environment),
                  );
                  const isUndefined = applyBinaryOperator(
                    "===",
                    methodType,
                    primitiveValue("undefined"),
                  );
                  const isFunction = applyBinaryOperator(
                    "===",
                    methodType,
                    primitiveValue("function"),
                  );
                  return evaluator.continueValue(
                    getConditionalValue(
                      isUndefined,
                      TRUE_VALUE,
                      getConditionalValue(isFunction, TRUE_VALUE, FALSE_VALUE),
                    ),
                    valueContext,
                    (permission) =>
                      getTruthiness(permission) === true
                        ? append(value)
                        : getDescriptorError(
                            `${name === "get" ? "Getter" : "Setter"} must be a function`,
                            location,
                          ),
                  );
                },
              );
            },
          ),
        );
      });
    }
    return evaluator.continueValue(result, sourceContext, (collected) => {
      if (collected.kind !== "object") return collected;
      const keys = getKnownOwnKeys(collected, () => true);
      return keys &&
        (keys.has("get") || keys.has("set")) &&
        (keys.has("value") || keys.has("writable"))
        ? getDescriptorError(
            "Invalid property descriptor. Cannot both specify accessors and a value or writable attribute",
            location,
          )
        : collected;
    });
  });

const getInheritedWritePermission = (
  target: StaticObjectValue | undefined,
  key: string,
): StaticValue => {
  if (!target) return TRUE_VALUE;
  const descriptor = getOwnPropertyDescriptor(target, key);
  if (!descriptor) return unknownPrimitiveValue("boolean", "unresolved inherited write permission");
  return mapValue(descriptor, (metadata) =>
    metadata.kind === "object"
      ? getObjectProperty(metadata, "writable")
      : getInheritedWritePermission(target.prototype, key),
  );
};

export const getPropertyWritePermission = (target: StaticObjectValue, key: string): StaticValue => {
  if (target.integrity?.kind === "branch")
    return mapValue(target.integrity, (integrity) =>
      getPropertyWritePermission({ ...target, integrity }, key),
    );
  if (target.integrity?.kind === "primitive" && target.integrity.value === "frozen")
    return FALSE_VALUE;
  const entry = getOwnPropertyEntry(target, key);
  if (entry) return getConditionalValue(entry.writable ?? TRUE_VALUE, TRUE_VALUE, FALSE_VALUE);
  const descriptor = getOwnPropertyDescriptor(target, key);
  if (!descriptor)
    return getConditionalValue(
      unknownPrimitiveValue("boolean", "unresolved write permission"),
      TRUE_VALUE,
      FALSE_VALUE,
    );
  return mapValue(descriptor, (metadata) =>
    metadata.kind === "object"
      ? getConditionalValue(getObjectProperty(metadata, "writable"), TRUE_VALUE, FALSE_VALUE)
      : getConjunction([
          getObjectExtensibility(target),
          getInheritedWritePermission(target.prototype, key),
        ]),
  );
};

export const getPropertyDeletePermission = (
  target: StaticObjectValue,
  key: string,
): StaticValue => {
  const descriptor = getOwnPropertyDescriptor(target, key);
  return descriptor
    ? mapValue(descriptor, (alternative) =>
        alternative.kind === "object"
          ? getConditionalValue(
              getObjectProperty(alternative, "configurable"),
              TRUE_VALUE,
              FALSE_VALUE,
            )
          : TRUE_VALUE,
      )
    : TRUE_VALUE;
};

export const getProxyDefinitionPermission = (
  target: StaticObjectValue,
  key: string,
  descriptor: StaticObjectValue,
  previous: StaticValue,
  location: SourceLocation | null,
): StaticValue => {
  const definition = getPropertyDefinition(target, key, descriptor, location, previous);
  if (!definition)
    return unknownPrimitiveValue("boolean", "unresolved proxy definition invariants");
  const keys = getKnownOwnKeys(descriptor, () => true);
  const setsNonConfigurable = keys?.has("configurable")
    ? getConditionalValue(getObjectProperty(descriptor, "configurable"), FALSE_VALUE, TRUE_VALUE)
    : FALSE_VALUE;
  if (previous.kind !== "object")
    return getConjunction([
      definition.permission,
      getConditionalValue(setsNonConfigurable, FALSE_VALUE, TRUE_VALUE),
    ]);
  const configurable = getObjectProperty(previous, "configurable");
  const checks = [
    definition.permission,
    getConditionalValue(
      configurable,
      getConditionalValue(setsNonConfigurable, FALSE_VALUE, TRUE_VALUE),
      TRUE_VALUE,
    ),
  ];
  if (keys?.has("writable"))
    checks.push(
      getConditionalValue(
        configurable,
        TRUE_VALUE,
        getConditionalValue(
          getObjectProperty(previous, "writable"),
          getObjectProperty(descriptor, "writable"),
          TRUE_VALUE,
        ),
      ),
    );
  return getConjunction(checks);
};

export const getPropertyDefinition = (
  target: StaticObjectValue,
  key: string,
  descriptor: StaticObjectValue,
  location: SourceLocation | null,
  previous: StaticValue | null,
): PropertyDefinition | null => {
  const keys = getKnownOwnKeys(descriptor, () => true);
  if (!keys || previous === null || (previous.kind !== "object" && !isUndefinedValue(previous)))
    return null;
  const isPresent = previous.kind === "object";
  const previousKeys = isPresent ? getKnownOwnKeys(previous, () => true) : null;
  const hasAccessor = keys.has("get") || keys.has("set");
  const hasData = keys.has("value") || keys.has("writable");
  const hadAccessor = previousKeys?.has("get") === true;
  const isAccessor = hasAccessor || (!hasData && hadAccessor);
  const getPrevious = (name: string, fallback: StaticValue): StaticValue =>
    previous.kind === "object" && previousKeys?.has(name)
      ? getObjectProperty(previous, name)
      : fallback;
  const getAttribute = (name: string, fallback: StaticValue): StaticValue =>
    keys.has(name) ? getObjectProperty(descriptor, name) : getPrevious(name, fallback);
  const enumerable = toBooleanValue(getAttribute("enumerable", FALSE_VALUE));
  const configurable = toBooleanValue(getAttribute("configurable", FALSE_VALUE));
  const writable = toBooleanValue(getAttribute("writable", FALSE_VALUE));
  const getter = getAttribute("get", UNDEFINED_VALUE);
  const setter = getAttribute("set", UNDEFINED_VALUE);
  const value = getAttribute("value", UNDEFINED_VALUE);
  const entry: StaticPropertyEntry = isAccessor
    ? { ...accessorEntry(key, { get: getter, set: setter }, location), enumerable, configurable }
    : { kind: "property", key, value, writable, enumerable, configurable };
  if (!isPresent)
    return {
      entry,
      permission: getConditionalValue(getObjectExtensibility(target), TRUE_VALUE, FALSE_VALUE),
    };
  const unchanged = [
    getConditionalValue(configurable, FALSE_VALUE, TRUE_VALUE),
    getSameValueCondition(enumerable, getPrevious("enumerable", FALSE_VALUE)),
    primitiveValue(isAccessor === hadAccessor),
  ];
  if (isAccessor && hadAccessor)
    unchanged.push(
      getSameValueCondition(getter, getPrevious("get", UNDEFINED_VALUE)),
      getSameValueCondition(setter, getPrevious("set", UNDEFINED_VALUE)),
    );
  else if (!isAccessor && !hadAccessor)
    unchanged.push(
      getConditionalValue(
        getPrevious("writable", FALSE_VALUE),
        TRUE_VALUE,
        getConjunction([
          getConditionalValue(writable, FALSE_VALUE, TRUE_VALUE),
          getSameValueCondition(value, getPrevious("value", UNDEFINED_VALUE)),
        ]),
      ),
    );
  return {
    entry,
    permission: getConditionalValue(
      getPrevious("configurable", FALSE_VALUE),
      TRUE_VALUE,
      getConjunction(unchanged),
    ),
  };
};

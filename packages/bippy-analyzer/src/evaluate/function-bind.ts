import type { HostRealm } from "../host/host-realm.js";
import type { SourceLocation } from "../parse/source-types.js";
import type { StaticFunctionValue, StaticValue } from "../types.js";
import type { BuiltinEvaluator } from "./builtin-calls.js";
import type { EvaluationContext } from "./context.js";
import { getFunctionOwnPresence } from "./has-property.js";
import { createFunctionProperties } from "./function-metadata.js";
import { concatenateStrings } from "./primitive-shapes.js";
import { getThrowCertainty } from "./thrown.js";
import { getTypeofValue } from "./value-typeof.js";
import {
  allocate,
  mapValue,
  getTruthiness,
  unknownValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
} from "./values.js";

interface FunctionBindEvaluator extends Pick<
  BuiltinEvaluator,
  "getProperty" | "callAlternatives" | "getRealm"
> {}

const continueMetadata = (
  evaluator: FunctionBindEvaluator,
  value: StaticValue,
  context: EvaluationContext,
  proceed: (value: StaticValue, context: EvaluationContext) => StaticValue,
): StaticValue => {
  const certainty = getThrowCertainty(value);
  if (certainty === "always") return value;
  if (certainty === "maybe" && value.kind === "branch")
    return evaluator.callAlternatives(value, context, (alternative, alternativeContext) =>
      continueMetadata(evaluator, alternative, alternativeContext, proceed),
    );
  return proceed(value, context);
};

const getBoundLength = (value: StaticValue, argumentCount: number, realm: HostRealm): StaticValue =>
  mapValue(value, (alternative) => {
    if (alternative.kind === "primitive" && typeof alternative.value === "number")
      return primitiveValue(Math.max(0, (Math.trunc(alternative.value) || 0) - argumentCount));
    const type = getTypeofValue(alternative, realm);
    return type.kind === "primitive" && type.value !== "number"
      ? primitiveValue(0)
      : unknownPrimitiveValue("number", "bound function length");
  });

const getBoundName = (value: StaticValue, realm: HostRealm): StaticValue =>
  mapValue(value, (alternative) => {
    const type = getTypeofValue(alternative, realm);
    const name =
      type.kind === "primitive"
        ? type.value === "string"
          ? alternative
          : primitiveValue("")
        : unknownPrimitiveValue("string", "bound target name");
    return concatenateStrings(primitiveValue("bound "), name);
  });

export const getBoundTarget = (target: StaticFunctionValue): StaticFunctionValue =>
  target.boundTarget ??
  (target.boundArgs || target.boundThis
    ? { ...target, boundArgs: undefined, boundThis: undefined, boundIdentity: undefined }
    : target);

export const bindFunction = (
  evaluator: FunctionBindEvaluator,
  target: StaticFunctionValue,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const bindPresent = (presence: StaticValue, bindContext: EvaluationContext): StaticValue => {
    const hasLength = getTruthiness(presence);
    if (hasLength === null) return unknownValue("dynamic bound length presence", location);
    return continueMetadata(
      evaluator,
      hasLength
        ? evaluator.getProperty(target, "length", bindContext, location)
        : primitiveValue(0),
      bindContext,
      (length, lengthContext) => {
        const realm = evaluator.getRealm(lengthContext.environment);
        const boundLength = getBoundLength(length, Math.max(0, args.length - 1), realm);
        return continueMetadata(
          evaluator,
          evaluator.getProperty(target, "name", lengthContext, location),
          lengthContext,
          (name) => {
            const boundName = getBoundName(name, realm);
            return {
              ...target,
              name:
                boundName.kind === "primitive" && typeof boundName.value === "string"
                  ? boundName.value
                  : null,
              properties: createFunctionProperties(boundLength, boundName),
              hasStoredMetadata: true,
              hasPrototype: false,
              boundIdentity: allocate(),
              boundTarget: getBoundTarget(target),
              boundThis: target.boundThis ?? args[0] ?? UNDEFINED_VALUE,
              boundArgs: [...(target.boundArgs ?? []), ...args.slice(1)],
            };
          },
        );
      },
    );
  };
  const presence = getFunctionOwnPresence(target, "length");
  return presence.kind === "branch"
    ? evaluator.callAlternatives(presence, context, bindPresent)
    : bindPresent(presence, context);
};

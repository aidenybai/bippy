import type { SourceLocation } from "../parse/source-types.js";
import type { StaticValue } from "../types.js";
import { MAX_ARRAY_LIKE_LENGTH } from "./array-methods.js";
import type { BuiltinEvaluator } from "./builtin-calls.js";
import type { EvaluationContext } from "./context.js";
import { createErrorValue } from "./errors.js";
import { getThrowCertainty } from "./thrown.js";
import { getTypeofValue } from "./value-typeof.js";
import {
  isNullish,
  listValue,
  mapFiniteListItems,
  primitiveValue,
  thrownValue,
  unknownValue,
} from "./values.js";

interface ArgumentListEvaluator extends Pick<
  BuiltinEvaluator,
  "getProperty" | "callAlternatives" | "getRealm"
> {}

const argumentListError = (message: string, location: SourceLocation | null): StaticValue =>
  thrownValue(
    "invalid argument list",
    createErrorValue("TypeError", [primitiveValue(message)], location),
    location,
  );

const continueAlternatives = (
  evaluator: ArgumentListEvaluator,
  value: StaticValue,
  context: EvaluationContext,
  proceed: (value: StaticValue, context: EvaluationContext) => StaticValue,
): StaticValue =>
  value.kind === "branch"
    ? evaluator.callAlternatives(value, context, proceed)
    : proceed(value, context);

const readArgumentList = (
  evaluator: ArgumentListEvaluator,
  source: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
  allowNullish: boolean,
): StaticValue => {
  if (source.kind === "branch")
    return evaluator.callAlternatives(source, context, (alternative, alternativeContext) =>
      readArgumentList(evaluator, alternative, alternativeContext, location, allowNullish),
    );
  if (getThrowCertainty(source) === "always") return source;
  if (isNullish(source) === true)
    return allowNullish
      ? listValue([])
      : argumentListError("CreateListFromArrayLike called on non-object", location);
  if (source.kind === "list")
    return (
      mapFiniteListItems(source.items, listValue) ??
      unknownValue("indefinite argument list", location)
    );
  const sourceType = getTypeofValue(source, evaluator.getRealm(context.environment));
  if (sourceType.kind !== "primitive") return unknownValue("dynamic argument list", location);
  if (sourceType.value !== "object" && sourceType.value !== "function")
    return argumentListError("CreateListFromArrayLike called on non-object", location);
  const length = evaluator.getProperty(source, "length", context, location);
  return continueAlternatives(evaluator, length, context, (lengthValue, lengthContext) => {
    if (getThrowCertainty(lengthValue) === "always") return lengthValue;
    if (
      lengthValue.kind === "symbol" ||
      (lengthValue.kind === "primitive" && typeof lengthValue.value === "symbol")
    )
      return argumentListError("Cannot convert a Symbol value to a number", location);
    if (lengthValue.kind !== "primitive")
      return unknownValue("dynamic argument list length", location);
    if (typeof lengthValue.value === "bigint")
      return argumentListError("Cannot convert a BigInt value to a number", location);
    const count = Math.min(
      Math.max(Math.trunc(Number(lengthValue.value)) || 0, 0),
      Number.MAX_SAFE_INTEGER,
    );
    if (count > MAX_ARRAY_LIKE_LENGTH)
      return unknownValue("argument list exceeds supported length", location);
    let result: StaticValue = listValue([]);
    for (let index = 0; index < count; index++) {
      result = continueAlternatives(evaluator, result, lengthContext, (prefix, prefixContext) => {
        if (prefix.kind !== "list") return prefix;
        const item = evaluator.getProperty(source, String(index), prefixContext, location);
        const appendItem = (value: StaticValue): StaticValue =>
          getThrowCertainty(value) === "never" ? listValue([...prefix.items, value]) : value;
        return getThrowCertainty(item) === "never"
          ? appendItem(item)
          : continueAlternatives(evaluator, item, prefixContext, appendItem);
      });
      if (getThrowCertainty(result) === "always" || result.kind === "unknown") return result;
    }
    return result;
  });
};

export const callWithArgumentList = (
  evaluator: ArgumentListEvaluator,
  source: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
  allowNullish: boolean,
  call: (args: StaticValue[], context: EvaluationContext) => StaticValue,
): StaticValue =>
  continueAlternatives(
    evaluator,
    readArgumentList(evaluator, source, context, location, allowNullish),
    context,
    (argumentsValue, argumentsContext) =>
      argumentsValue.kind === "list" && getThrowCertainty(argumentsValue) === "never"
        ? call(argumentsValue.items, argumentsContext)
        : argumentsValue,
  );

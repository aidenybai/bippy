import type { SourceLocation } from "../parse/source-types.js";
import type { StaticValue } from "../types.js";
import { mapArrayLikeItems } from "./array-like.js";
import { iterableOrArrayLike, mapList } from "./array-methods.js";
import type { BuiltinEvaluator } from "./builtin-calls.js";
import { callCallback } from "./callbacks.js";
import type { EvaluationContext } from "./context.js";
import { createErrorValue } from "./errors.js";
import { isGeneratorValue } from "./generators.js";
import { getThrowCertainty } from "./thrown.js";
import { binaryFromItems } from "./typed-arrays.js";
import { getTypeofValue } from "./value-typeof.js";
import {
  isCallable,
  isNullish,
  ITERATOR_PROPERTY_KEY,
  listValue,
  mapValue,
  primitiveValue,
  spreadListItems,
  thrownValue,
  unknownValue,
} from "./values.js";

const getSourceError = (
  nativeSource: unknown,
  isTyped: boolean,
  location: SourceLocation | null,
): StaticValue => {
  try {
    Reflect.apply(isTyped ? Uint8Array.from : Array.from, isTyped ? Uint8Array : Array, [
      nativeSource,
    ]);
  } catch (error) {
    if (error instanceof TypeError)
      return thrownValue(
        "invalid from source",
        createErrorValue("TypeError", [primitiveValue(error.message)], location),
        location,
      );
  }
  return unknownValue("from source validation", location);
};

export const callArrayFrom = (
  evaluator: BuiltinEvaluator,
  constructorName: string,
  source: StaticValue,
  mapper: StaticValue | undefined,
  thisValue: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const isTyped = constructorName !== "Array";
  const complete = (value: StaticValue): StaticValue =>
    mapValue(value, (alternative) =>
      alternative.kind === "list" && getThrowCertainty(alternative) === "never" && isTyped
        ? (binaryFromItems(constructorName, alternative.items) ?? alternative)
        : alternative,
    );
  const consumeIterable = (value: StaticValue, iterableContext: EvaluationContext): StaticValue => {
    if (value.kind === "branch")
      return evaluator.callAlternatives(value, iterableContext, consumeIterable);
    if (getThrowCertainty(value) === "always") return value;
    if (isTyped && value.kind !== "list")
      return unknownValue(`${constructorName}.from of dynamic iterable`, location);
    const items =
      value.kind === "list"
        ? isTyped
          ? listValue([...value.items])
          : value
        : value.kind === "repeat"
          ? value
          : listValue(spreadListItems(value, location));
    return complete(
      mapper
        ? mapList(evaluator, items, mapper, iterableContext, location, {
            includeReceiver: false,
            thisValue,
          })
        : items.kind === "list"
          ? listValue([...items.items])
          : items,
    );
  };
  if (isGeneratorValue(source))
    return consumeIterable(evaluator.resolveIterable(source, context, location), context);
  if (isNullish(source) === true)
    return getSourceError(
      source.kind === "primitive" ? source.value : undefined,
      isTyped,
      location,
    );
  if (
    source.kind === "object" ||
    source.kind === "symbol" ||
    (source.kind === "primitive" && typeof source.value !== "string")
  ) {
    const consumeMethod = (method: StaticValue, methodContext: EvaluationContext): StaticValue => {
      if (getThrowCertainty(method) === "always") return method;
      if (isNullish(method) === true)
        return complete(
          mapArrayLikeItems(
            evaluator,
            source,
            methodContext,
            location,
            mapper
              ? (value, index, itemContext) =>
                  callCallback(evaluator, mapper, [value, primitiveValue(index)], itemContext, {
                    thisValue,
                  })
              : undefined,
          ),
        );
      const methodType = getTypeofValue(method, evaluator.getRealm(methodContext.environment));
      if (methodType.kind !== "primitive")
        return unknownValue("dynamic from iterator method", location);
      if (methodType.value !== "function")
        return getSourceError({ [Symbol.iterator]: 5 }, isTyped, location);
      if (!isCallable(method)) return unknownValue("unsupported from iterator method", location);
      return consumeIterable(
        evaluator.resolveIterable(source, methodContext, location, method),
        methodContext,
      );
    };
    const method = evaluator.getProperty(source, ITERATOR_PROPERTY_KEY, context, location);
    return method.kind === "branch"
      ? evaluator.callAlternatives(method, context, consumeMethod)
      : consumeMethod(method, context);
  }
  const iterable = iterableOrArrayLike(evaluator, source, context, location);
  return iterable
    ? consumeIterable(iterable, context)
    : unknownValue(`${constructorName}.from of dynamic iterable`, location);
};

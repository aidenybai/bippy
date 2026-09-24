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
import {
  convertTypedElements,
  createTypedElementConverter,
  isTypedArrayName,
} from "./typed-arrays.js";
import { getTypeofValue } from "./value-typeof.js";
import {
  isCallable,
  isNullish,
  ITERATOR_PROPERTY_KEY,
  listValue,
  mapFiniteListItems,
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
  const typedKind = isTypedArrayName(constructorName) ? constructorName : null;
  const isTyped = typedKind !== null;
  const operation = `${constructorName}.from()`;
  const mapperScope = mapper?.kind === "function" ? mapper.scope : undefined;
  const callAlternatives: BuiltinEvaluator["callAlternatives"] = (branch, pathContext, call) =>
    evaluator.callAlternatives(branch, pathContext, call, mapperScope);
  const convert =
    typedKind === null ? null : createTypedElementConverter(typedKind, location, operation);
  const mapItem = (
    value: StaticValue,
    index: number,
    itemContext: EvaluationContext,
  ): StaticValue => {
    const mapped = mapper
      ? callCallback(evaluator, mapper, [value, primitiveValue(index)], itemContext, { thisValue })
      : value;
    return convert ? convert(mapped) : mapped;
  };
  const complete = (value: StaticValue): StaticValue =>
    mapValue(value, (alternative) =>
      alternative.kind === "list" &&
      getThrowCertainty(alternative) === "never" &&
      typedKind !== null
        ? convertTypedElements(typedKind, alternative.items, location, operation)
        : alternative,
    );
  const mapTypedIterable = (
    items: StaticValue[],
    iterableContext: EvaluationContext,
  ): StaticValue => {
    const expanded = mapFiniteListItems(items, listValue);
    if (!expanded) return unknownValue(`${operation} with indefinite iterable`, location);
    const consume = (sourceList: StaticValue, sourceContext: EvaluationContext): StaticValue => {
      if (sourceList.kind !== "list") return sourceList;
      let result: StaticValue = listValue([]);
      for (const [index, item] of sourceList.items.entries()) {
        const append = (prefix: StaticValue, itemContext: EvaluationContext): StaticValue => {
          if (prefix.kind !== "list") return prefix;
          const mapped = mapItem(item, index, itemContext);
          if (
            mapped.kind === "branch" &&
            mapped.alternatives.some((alternative) => alternative.kind !== "primitive")
          )
            return callAlternatives(mapped, itemContext, (alternative) =>
              alternative.kind === "unknown" || getThrowCertainty(alternative) !== "never"
                ? alternative
                : listValue([...prefix.items, alternative]),
            );
          if (mapped.kind === "unknown" || getThrowCertainty(mapped) !== "never") return mapped;
          prefix.items.push(mapped);
          return prefix;
        };
        result =
          result.kind === "branch"
            ? callAlternatives(result, sourceContext, (prefix, prefixContext) =>
                append(
                  prefix.kind === "list" ? listValue([...prefix.items]) : prefix,
                  prefixContext,
                ),
              )
            : append(result, sourceContext);
        if (getThrowCertainty(result) === "always" || result.kind === "unknown") break;
      }
      return complete(result);
    };
    return expanded.kind === "branch"
      ? callAlternatives(expanded, iterableContext, consume)
      : consume(expanded, iterableContext);
  };
  const consumeIterable = (value: StaticValue, iterableContext: EvaluationContext): StaticValue => {
    if (value.kind === "branch") return callAlternatives(value, iterableContext, consumeIterable);
    if (getThrowCertainty(value) === "always") return value;
    if (isTyped && value.kind !== "list")
      return unknownValue(`${constructorName}.from of dynamic iterable`, location);
    if (isTyped && value.kind === "list")
      return mapTypedIterable([...value.items], iterableContext);
    const items =
      value.kind === "list"
        ? value
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
            mapper || convert ? mapItem : undefined,
            mapperScope,
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
      ? callAlternatives(method, context, consumeMethod)
      : consumeMethod(method, context);
  }
  const iterable = iterableOrArrayLike(evaluator, source, context, location);
  return iterable
    ? consumeIterable(iterable, context)
    : unknownValue(`${constructorName}.from of dynamic iterable`, location);
};

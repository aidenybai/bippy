import type { SourceLocation } from "../parse/source-types.js";
import type { StaticListValue, StaticValue } from "../types.js";
import { MAX_ARRAY_LIKE_LENGTH } from "./array-like.js";
import type { ArrayMethodEvaluator } from "./array-methods.js";
import type { EvaluationContext } from "./context.js";
import { createErrorValue } from "./errors.js";
import { getThrowCertainty } from "./thrown.js";
import { createTypedElementConverter, fillBinaryUnknown, getBinaryKind } from "./typed-arrays.js";
import {
  hasDefiniteItems,
  MAX_DISTRIBUTED_ALTERNATIVES,
  isNullish,
  listValue,
  mapFiniteListItems,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

interface TypedSetEvaluator extends Pick<
  ArrayMethodEvaluator,
  "getProperty" | "recordHeapMutation" | "callAlternatives"
> {}

export const callTypedSet = (
  evaluator: TypedSetEvaluator,
  target: StaticListValue,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const kind = getBinaryKind(target);
  if (!kind || kind === "ArrayBuffer")
    return unknownValue("typed array set with an incompatible receiver", location);
  const operation = `${kind}.set()`;
  const convertElement = createTypedElementConverter(kind, location, operation);
  const convertNumber = createTypedElementConverter("Float64Array", location, operation);
  const refuse = (reason: string): StaticValue => {
    evaluator.recordHeapMutation(target);
    fillBinaryUnknown(target, `${operation}: ${reason}`);
    return unknownValue(`${operation}: ${reason}`, location);
  };
  const error = (name: "TypeError" | "RangeError", message: string): StaticValue =>
    thrownValue(operation, createErrorValue(name, [primitiveValue(message)], location), location);
  const continueValue = (
    value: StaticValue,
    currentContext: EvaluationContext,
    proceed: (value: StaticValue, context: EvaluationContext) => StaticValue,
  ): StaticValue =>
    value.kind === "branch"
      ? evaluator.callAlternatives(value, currentContext, (alternative, alternativeContext) =>
          continueValue(alternative, alternativeContext, proceed),
        )
      : getThrowCertainty(value) === "always"
        ? value
        : proceed(value, currentContext);
  const store = (element: StaticValue, index: number): StaticValue => {
    if (getThrowCertainty(element) === "always") return element;
    if (
      element.kind !== "primitive" &&
      !(
        element.kind === "branch" &&
        element.alternatives.every((alternative) => alternative.kind === "primitive")
      )
    )
      return refuse("unsupported element conversion");
    evaluator.recordHeapMutation(target);
    target.items[index] = element;
    return UNDEFINED_VALUE;
  };
  const consume = (
    source: StaticValue,
    offset: number,
    count: number,
    currentContext: EvaluationContext,
  ): StaticValue => {
    if (!hasDefiniteItems(target)) return refuse("indefinite target length");
    if (offset + count > target.items.length) return error("RangeError", "offset is out of bounds");
    if (source.kind !== "list" && count > MAX_ARRAY_LIKE_LENGTH)
      return refuse("array-like source exceeds supported length");
    const snapshot =
      source.kind === "list" && getBinaryKind(source) && getBinaryKind(source) !== "ArrayBuffer"
        ? [...source.items]
        : null;
    const write = (
      start: number,
      writeContext: EvaluationContext,
      alternativeBudget: number,
    ): StaticValue => {
      for (let index = start; index < count; index++) {
        const item = snapshot
          ? snapshot[index]
          : evaluator.getProperty(source, String(index), writeContext, location);
        const converted = convertElement(item);
        if (
          converted.kind === "branch" &&
          !converted.alternatives.every((alternative) => alternative.kind === "primitive")
        ) {
          if (converted.alternatives.length > alternativeBudget)
            return refuse("element completion alternatives exceed supported limit");
          const remainingBudget = Math.floor(alternativeBudget / converted.alternatives.length);
          return continueValue(converted, writeContext, (element, elementContext) => {
            const result = store(element, offset + index);
            return result === UNDEFINED_VALUE
              ? write(index + 1, elementContext, remainingBudget)
              : result;
          });
        }
        const result = store(converted, offset + index);
        if (result !== UNDEFINED_VALUE) return result;
      }
      return UNDEFINED_VALUE;
    };
    return write(0, currentContext, MAX_DISTRIBUTED_ALTERNATIVES);
  };
  const readSource = (
    source: StaticValue,
    offset: number,
    currentContext: EvaluationContext,
  ): StaticValue =>
    continueValue(source, currentContext, (sourceValue, sourceContext) => {
      if (isNullish(sourceValue) === true)
        return error("TypeError", "Cannot convert undefined or null to object");
      if (sourceValue.kind === "list") {
        if (getBinaryKind(sourceValue) === "ArrayBuffer")
          return refuse("ArrayBuffer source properties are unsupported");
        const sourceItems = sourceValue.items;
        if (hasDefiniteItems(sourceValue))
          return consume(sourceValue, offset, sourceItems.length, sourceContext);
        const finite = mapFiniteListItems(sourceItems, listValue);
        return finite
          ? continueValue(finite, sourceContext, (alternative, alternativeContext) =>
              readSource(alternative, offset, alternativeContext),
            )
          : refuse("indefinite source length");
      }
      const length = evaluator.getProperty(sourceValue, "length", sourceContext, location);
      return continueValue(convertNumber(length), sourceContext, (lengthValue, lengthContext) => {
        if (lengthValue.kind !== "primitive" || typeof lengthValue.value !== "number")
          return refuse("unsupported source length");
        const count = Math.min(
          Math.max(Math.trunc(lengthValue.value) || 0, 0),
          Number.MAX_SAFE_INTEGER,
        );
        return consume(sourceValue, offset, count, lengthContext);
      });
    });
  return continueValue(
    convertNumber(args[1] ?? UNDEFINED_VALUE),
    context,
    (offsetValue, offsetContext) => {
      if (offsetValue.kind !== "primitive" || typeof offsetValue.value !== "number")
        return refuse("unsupported offset");
      const offset = Math.trunc(offsetValue.value) || 0;
      return offset < 0
        ? error("RangeError", "offset is out of bounds")
        : readSource(args[0] ?? UNDEFINED_VALUE, offset, offsetContext);
    },
  );
};

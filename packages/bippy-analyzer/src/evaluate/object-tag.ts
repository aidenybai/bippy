import type { SourceLocation } from "../parse/source-types.js";
import type {
  StaticClassValue,
  StaticFunctionValue,
  StaticListValue,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import type { ArrayMethodEvaluator } from "./array-methods.js";
import { isClockDateValue } from "./clock-date.js";
import type { EvaluationContext } from "./context.js";
import { getErrorWitness } from "./errors.js";
import { getPrimitiveWitness } from "./host-globals.js";
import { getBuiltinWitness, getPrototypeWitness } from "./instance-of.js";
import { concatenateStrings } from "./primitive-shapes.js";
import { getThrowCertainty } from "./thrown.js";
import { getBinaryKind } from "./typed-arrays.js";
import {
  describeValue,
  getSymbolPropertyKey,
  primitiveValue,
  unknownPrimitiveValue,
} from "./values.js";

interface ObjectTagEvaluator extends Pick<
  ArrayMethodEvaluator,
  "getProperty" | "callAlternatives"
> {}

const tagOf = (witness: unknown): string => Object.prototype.toString.call(witness);

const getTag = (value: StaticValue): string | null => {
  switch (value.kind) {
    case "primitive":
      return tagOf(value.value);
    case "symbol":
      return tagOf(Symbol.iterator);
    case "unknown-primitive":
      return value.primitiveType === "any" ? null : tagOf(getPrimitiveWitness(value.primitiveType));
    case "repeat":
      return tagOf([]);
    case "namespace":
      return "[object Module]";
    case "global": {
      const intrinsic = getBuiltinWitness(value.name);
      if (intrinsic !== null) return tagOf(intrinsic);
      const witness = getPrototypeWitness(value);
      return witness === null ? null : tagOf(witness);
    }
    default: {
      const witness = getPrototypeWitness(value);
      return witness === null ? null : tagOf(witness);
    }
  }
};

const getBuiltinTag = (
  value: StaticObjectValue | StaticListValue | StaticFunctionValue | StaticClassValue,
): string | null => {
  if (value.kind === "list") return getBinaryKind(value) === null ? "Array" : "Object";
  if (value.kind === "function" || value.kind === "class") return "Function";
  if (isClockDateValue(value)) return "Date";
  if (getErrorWitness(value)) return "Error";
  return getPrototypeWitness(value) === null ? null : "Object";
};

export const getObjectTag = (
  evaluator: ObjectTagEvaluator,
  value: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (value.kind === "branch")
    return evaluator.callAlternatives(value, context, (alternative, alternativeContext) =>
      getObjectTag(evaluator, alternative, alternativeContext, location),
    );
  if (
    value.kind === "object" ||
    value.kind === "list" ||
    value.kind === "function" ||
    value.kind === "class"
  ) {
    const defaultTag = getBuiltinTag(value);
    const finish = (tag: StaticValue): StaticValue => {
      if (getThrowCertainty(tag) === "always") return tag;
      if (
        (tag.kind === "primitive" && typeof tag.value === "string") ||
        (tag.kind === "unknown-primitive" && tag.primitiveType === "string")
      )
        return concatenateStrings(
          concatenateStrings(primitiveValue("[object "), tag),
          primitiveValue("]"),
        );
      if (
        tag.kind === "unknown" ||
        tag.kind === "external" ||
        (tag.kind === "unknown-primitive" && tag.primitiveType === "any")
      )
        return unknownPrimitiveValue("string", "dynamic object tag");
      return defaultTag === null
        ? unknownPrimitiveValue("string", `Object.prototype.toString.call(${describeValue(value)})`)
        : primitiveValue(`[object ${defaultTag}]`);
    };
    const tag = evaluator.getProperty(
      value,
      getSymbolPropertyKey({ kind: "symbol", key: "Symbol.toStringTag" }),
      context,
      location,
    );
    return tag.kind === "branch" ? evaluator.callAlternatives(tag, context, finish) : finish(tag);
  }
  const tag = getTag(value);
  return tag === null
    ? unknownPrimitiveValue("string", `Object.prototype.toString.call(${describeValue(value)})`)
    : primitiveValue(tag);
};

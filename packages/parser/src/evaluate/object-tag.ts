import type { StaticValue } from "../types.js";
import { getBuiltinWitness, getPrototypeWitness } from "./instance-of.js";
import { describeValue, mapValue, primitiveValue, unknownPrimitiveValue } from "./values.js";

const PRIMITIVE_WITNESSES: Record<string, unknown> = {
  string: "",
  number: 0,
  boolean: false,
};

const tagOf = (witness: unknown): string => Object.prototype.toString.call(witness);

const getTag = (value: StaticValue): string | null => {
  switch (value.kind) {
    case "primitive":
      return tagOf(value.value);
    case "symbol":
      return tagOf(Symbol.iterator);
    case "unknown-primitive":
      return value.primitiveType === "any" ? null : tagOf(PRIMITIVE_WITNESSES[value.primitiveType]);
    case "repeat":
      return tagOf([]);
    case "namespace":
      return "[object Module]";
    case "global": {
      const intrinsic = getBuiltinWitness(value.name);
      if (intrinsic !== undefined) return tagOf(intrinsic);
      const witness = getPrototypeWitness(value);
      return witness === null ? null : tagOf(witness);
    }
    default: {
      const witness = getPrototypeWitness(value);
      return witness === null ? null : tagOf(witness);
    }
  }
};

/** `Object.prototype.toString.call(value)`; an unknown string when the tag depends on values the analysis cannot see. */
export const getObjectTag = (value: StaticValue): StaticValue =>
  mapValue(value, (alternative) => {
    const tag = getTag(alternative);
    return tag === null
      ? unknownPrimitiveValue(
          "string",
          `Object.prototype.toString.call(${describeValue(alternative)})`,
        )
      : primitiveValue(tag);
  });

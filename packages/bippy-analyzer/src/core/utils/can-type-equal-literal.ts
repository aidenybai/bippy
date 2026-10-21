import type { AbstractValue, BinaryOperator, PrimitiveValue } from "../types";
import { assertExhaustive } from "../../react-compiler/Utils/utils";
import { LOOSE_EQUALITY_OPERATORS } from "./is-equal-to-literal";
import { isNullish } from "./is-nullish";

export const canTypeEqualLiteral = (
  value: AbstractValue,
  literal: PrimitiveValue,
  operator: BinaryOperator,
): boolean => {
  if (value.kind === "Literal") return false;
  if (value.text === "any" || value.text === "unknown" || value.text === "{}") return true;
  if (LOOSE_EQUALITY_OPERATORS.has(operator)) return !isNullish(literal);
  switch (value.primitive) {
    case "string":
      return typeof literal === "string";
    case "number":
      return typeof literal === "number";
    case "bigint":
      return typeof literal === "bigint";
    case "boolean":
      return typeof literal === "boolean";
    case null:
      return false;
    default:
      return assertExhaustive(value.primitive, "Unhandled primitive type");
  }
};

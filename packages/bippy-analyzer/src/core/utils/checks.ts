import { assertExhaustive } from "../../react-compiler/Utils/utils";
import type {
  AbstractValue,
  BinaryOperator,
  Binding,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
} from "../types";
import { getValueKey } from "./value-key";

export const isWholeBinding = (value: SymbolicValue, binding: Binding): boolean =>
  value.kind === "Binding" && value.binding.id === binding.id && value.path.length === 0;

export const isStateBinding = (binding: Binding): boolean =>
  binding.kind === "state" || binding.kind === "reducer";

export const isExternalSource = (binding: Binding): boolean =>
  binding.kind === "hook" || binding.kind === "context";

export const isNullish = (value: PrimitiveValue): boolean => value === null || value === undefined;

export const isEqualToLiteral = (
  value: AbstractValue,
  literal: PrimitiveValue,
  operator: BinaryOperator,
): boolean => {
  if (value.kind !== "Literal") return false;
  if ((operator === "==" || operator === "!=") && isNullish(literal)) return isNullish(value.value);
  return value.value === literal;
};

export const canTypeEqualLiteral = (value: AbstractValue, literal: PrimitiveValue): boolean => {
  if (value.kind === "Literal") return false;
  if (value.text === "any" || value.text === "unknown") return true;
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

export const isRenderingNothing = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" &&
  (value.value === null || value.value === undefined || typeof value.value === "boolean");

const isLogicalAnd = (conditional: ConditionalValue): boolean =>
  getValueKey(conditional.alternate) === getValueKey(conditional.test);

export const isRenderingNothingWhenFalse = (conditional: ConditionalValue): boolean =>
  isRenderingNothing(conditional.alternate) || isLogicalAnd(conditional);

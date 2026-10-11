import { assertExhaustive } from "../../compiler/utils/utils.js";
import type {
  AbstractValue,
  Binding,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
} from "../types.js";
import { formatSymbolicValue } from "../format.js";

export const isWholeBinding = (value: SymbolicValue, binding: Binding): boolean =>
  value.kind === "Binding" && value.binding.id === binding.id && value.path.length === 0;

export const isStateBinding = (binding: Binding): boolean =>
  binding.kind === "state" || binding.kind === "reducer";

/**
 * A custom hook's result or a context value: data the component reads but doesn't own.
 */
export const isExternalSource = (binding: Binding): boolean =>
  binding.kind === "hook" || binding.kind === "context";

export const isNullish = (value: PrimitiveValue): boolean => value === null || value === undefined;

/**
 * Whether `value` satisfies `value <operator> literal` for `===`/`==` (negations are
 * the caller's job). `==` treats `null` and `undefined` as equal.
 */
export const isEqualToLiteral = (
  value: AbstractValue,
  literal: PrimitiveValue,
  operator: string,
): boolean => {
  if (value.kind !== "Literal") return false;
  if ((operator === "==" || operator === "!=") && isNullish(literal)) return isNullish(value.value);
  return value.value === literal;
};

/**
 * Whether a value of type `value` could equal `literal`. `string` could be `"a"`; `User` can't be `null`.
 */
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

/**
 * Whether React renders nothing for this value: `null`, `undefined`, or a boolean.
 */
export const isRenderingNothing = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" &&
  (value.value === null || value.value === undefined || typeof value.value === "boolean");

/**
 * Whether the alternate of a conditional renders nothing, as in `cond && <A />`, where it is
 * either an empty value or the test itself.
 */
export const isRenderingNothingWhenFalse = (conditional: ConditionalValue): boolean =>
  isRenderingNothing(conditional.alternate) ||
  formatSymbolicValue(conditional.alternate) === formatSymbolicValue(conditional.test);

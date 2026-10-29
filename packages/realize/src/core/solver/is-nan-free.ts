import type { Binding, NumberRange, SymbolicValue } from "../types";

const NAN_FREE_OPERATORS = new Set(["+", "-", "*"]);

const isNaNFree = (
  value: SymbolicValue,
  isFiniteBinding: (binding: Binding) => boolean,
): boolean => {
  switch (value.kind) {
    case "Primitive":
      return typeof value.value === "number" && Number.isFinite(value.value);
    case "Binding":
      return value.path.length === 0
        ? isFiniteBinding(value.binding) ||
            (value.binding.range !== null && isNaNFreeRange(value.binding.range, isFiniteBinding))
        : value.path.at(-1) === "length";
    case "UnaryExpression":
      return value.operator === "-" && isNaNFree(value.value, isFiniteBinding);
    case "BinaryExpression":
      return (
        NAN_FREE_OPERATORS.has(value.operator) &&
        isNaNFree(value.left, isFiniteBinding) &&
        isNaNFree(value.right, isFiniteBinding)
      );
    case "Conditional":
      return (
        isNaNFree(value.consequent, isFiniteBinding) && isNaNFree(value.alternate, isFiniteBinding)
      );
    default:
      return false;
  }
};

export const isNaNFreeRange = (
  range: NumberRange,
  isFiniteBinding: (binding: Binding) => boolean,
): boolean => range.inner !== null && isNaNFree(range.inner, isFiniteBinding);

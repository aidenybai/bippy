import type { NumberRange, SymbolicValue } from "../types";

const getNumbers = (values: SymbolicValue[]): number[] =>
  values.flatMap((value) =>
    value.kind === "Primitive" && typeof value.value === "number" ? [value.value] : [],
  );

export const getClampRange = (
  methodName: string,
  argumentValues: SymbolicValue[],
): NumberRange | null => {
  const numbers = getNumbers(argumentValues);
  if (numbers.length === 0) return null;
  const others = argumentValues.filter((value) => getNumbers([value]).length === 0);
  const inner = others.length === 1 ? (others[0] ?? null) : null;
  if (methodName === "min") return { min: null, max: Math.min(...numbers), inner };
  if (methodName === "max") return { min: Math.max(...numbers), max: null, inner };
  return null;
};

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
  if (methodName === "min") return { min: null, max: Math.min(...numbers) };
  if (methodName === "max") return { min: Math.max(...numbers), max: null };
  return null;
};

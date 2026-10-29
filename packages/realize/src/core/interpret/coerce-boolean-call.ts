import type { SymbolicValue } from "../types";

export const coerceBooleanCall = (
  callee: SymbolicValue,
  argumentValues: SymbolicValue[],
): SymbolicValue | null => {
  const [argument] = argumentValues;
  const isBooleanCall =
    callee.kind === "Global" && callee.name === "Boolean" && callee.module === null;
  if (!isBooleanCall || !argument || argumentValues.length !== 1) return null;
  return {
    kind: "UnaryExpression",
    operator: "!",
    value: { kind: "UnaryExpression", operator: "!", value: argument },
  };
};

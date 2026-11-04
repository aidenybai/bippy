import type { PrimitiveValue } from "../types";

export type Comparison = "===" | "!==" | "==" | "!=" | "<" | "<=" | ">" | ">=";

export const FLIPPED: Record<Comparison, Comparison> = {
  "===": "===",
  "!==": "!==",
  "==": "==",
  "!=": "!=",
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

export const NEGATED: Record<Comparison, Comparison> = {
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
  "<": ">=",
  "<=": ">",
  ">": "<=",
  ">=": "<",
};

export const isComparison = (operator: string): operator is Comparison =>
  Object.hasOwn(FLIPPED, operator);

export const comparePrimitives = (
  left: PrimitiveValue,
  operator: Comparison,
  right: PrimitiveValue,
): boolean => {
  switch (operator) {
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
      // oxlint-disable-next-line eqeqeq -- Compares with JavaScript loose equality as written.
      return left == right;
    case "!=":
      // oxlint-disable-next-line eqeqeq -- Compares with JavaScript loose equality as written.
      return left != right;
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
  }
};

import type { SymbolicValue, ConditionalValue } from "../types";

export const getTestExpression = (
  branch: Pick<ConditionalValue, "test" | "testKind">,
): SymbolicValue =>
  branch.testKind === "nullish"
    ? {
        kind: "BinaryExpression",
        operator: "!=",
        left: branch.test,
        right: { kind: "Primitive", value: null },
      }
    : branch.test;

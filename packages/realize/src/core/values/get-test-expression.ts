import type { SymbolicValue, ConditionalValue } from "../types";
import { memoizeByIdentity } from "../shared/memoize-by-identity";

export const getTestExpression = memoizeByIdentity(
  (branch: Pick<ConditionalValue, "test" | "testKind">): SymbolicValue =>
    branch.testKind === "nullish"
      ? {
          kind: "BinaryExpression",
          operator: "!=",
          left: branch.test,
          right: { kind: "Primitive", value: null },
        }
      : branch.test,
);

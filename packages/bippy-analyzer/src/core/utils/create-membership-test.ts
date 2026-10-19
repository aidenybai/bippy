import { foldBinary } from "../symbolic-values";
import type { AbstractValue, Branch, SymbolicValue } from "../types";

export const createMembershipTest = (
  subject: SymbolicValue,
  cases: AbstractValue[],
  branch: Branch,
): SymbolicValue | null => {
  const tests = cases.flatMap((value): SymbolicValue[] =>
    value.kind === "Literal"
      ? [foldBinary("===", subject, { kind: "Primitive", value: value.value })]
      : [],
  );
  const lastTest = tests.at(-1);
  if (!lastTest || tests.length !== cases.length) return null;
  return tests.slice(0, -1).reduceRight<SymbolicValue>(
    (rest, test) => ({
      kind: "Conditional",
      test,
      testKind: "truthy",
      consequent: test,
      alternate: rest,
      branch,
      guardKeys: [],
    }),
    lastTest,
  );
};

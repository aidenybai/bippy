import { expect, it } from "vite-plus/test";
import { getNativeObjectMember } from "../src/evaluate/native-values.js";
import { applyBinaryOperator } from "../src/evaluate/operators.js";
import { getCaughtValue, getThrowCertainty } from "../src/evaluate/thrown.js";
import { getObjectProperty, primitiveValue } from "../src/evaluate/values.js";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";
it.each(["/", "%", "**"])("preserves native error branding for %s", (operator) =>
  checkDifferentialCases([
    {
      name: `RangeError identity for ${operator}`,
      body: `try { 1n ${operator} (${operator === "**" ? "-1n" : "0n"}); return 'after'; } catch (error) { return (error instanceof RangeError) + ':' + (error instanceof Error) + ':' + typeof error.stack; }`,
    },
  ]),
);
it("does not execute unsupported positive powers or growing shifts", () => {
  const hugeCount = primitiveValue(1n << 1024n);
  for (const operator of ["**", "<<", ">>"]) {
    const result = applyBinaryOperator(operator, primitiveValue(2n), hugeCount);
    expect(result.kind).toBe("unknown-primitive");
    expect(getThrowCertainty(result)).toBe("never");
  }
});
it.each(["/", "%", "**"])("keeps the host stack opaque for %s errors", (operator) => {
  const caught = getCaughtValue(
    applyBinaryOperator(operator, primitiveValue(1n), primitiveValue(operator === "**" ? -1n : 0n)),
    null,
  );
  const stack =
    caught.kind === "native-object"
      ? getNativeObjectMember(caught, "stack")
      : caught.kind === "object"
        ? getObjectProperty(caught, "stack")
        : caught;
  expect(stack.kind).toBe("unknown-primitive");
});
it("rejects a negative exponent without executing a growing power", () => {
  const result = applyBinaryOperator("**", primitiveValue(2n), primitiveValue(-(1n << 1024n)));
  expect(getThrowCertainty(result)).toBe("always");
});
it("does not apply arithmetic type errors to mixed relational comparisons", () => {
  for (const operator of ["<", ">", "<=", ">="]) {
    expect(
      getThrowCertainty(applyBinaryOperator(operator, primitiveValue(1n), primitiveValue(2))),
    ).toBe("never");
  }
});

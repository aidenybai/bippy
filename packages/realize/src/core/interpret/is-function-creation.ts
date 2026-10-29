import type { InstructionValue } from "../../react-compiler/HIR/HIR";

export const isFunctionCreation = (
  value: InstructionValue,
): value is Extract<InstructionValue, { kind: "FunctionExpression" | "ObjectMethod" }> =>
  value.kind === "FunctionExpression" || value.kind === "ObjectMethod";

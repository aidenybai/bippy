import type { SymbolicValue } from "../types";

export const flattenArrayChildren = (children: SymbolicValue[]): SymbolicValue[] =>
  children.flatMap((child) =>
    child.kind === "ArrayExpression"
      ? flattenArrayChildren([...child.elements, ...child.spreads])
      : [child],
  );

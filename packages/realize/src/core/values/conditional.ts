import type { ConditionalValue, SymbolicValue } from "../types";
import { getTestExpression } from "./get-test-expression";
import { negate } from "./negate";

export const forkConditional = <Result>(
  conditional: ConditionalValue,
  guards: SymbolicValue[],
  visitBranch: (branch: SymbolicValue, branchGuards: SymbolicValue[]) => Result,
): [Result, Result] => {
  const test = getTestExpression(conditional);
  return [
    visitBranch(conditional.consequent, [...guards, test]),
    visitBranch(conditional.alternate, [...guards, negate(test)]),
  ];
};

export const mapConditionalLeaves = (
  value: SymbolicValue,
  mapLeaf: (leaf: SymbolicValue) => SymbolicValue,
): SymbolicValue =>
  value.kind === "Conditional"
    ? {
        ...value,
        consequent: mapConditionalLeaves(value.consequent, mapLeaf),
        alternate: mapConditionalLeaves(value.alternate, mapLeaf),
      }
    : mapLeaf(value);

export const getConditionalLeaves = (value: SymbolicValue): SymbolicValue[] =>
  value.kind === "Conditional"
    ? [...getConditionalLeaves(value.consequent), ...getConditionalLeaves(value.alternate)]
    : [value];

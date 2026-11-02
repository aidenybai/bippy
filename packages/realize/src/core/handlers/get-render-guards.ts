import type { JsxExpressionValue, SymbolicValue } from "../types";
import { forEachPropNode } from "../render/for-each-jsx-element";
import { getRenderChildren } from "../render/get-render-children";
import { getTestExpression } from "../values/get-test-expression";
import { getValueKey } from "../values/get-value-key";
import { negate } from "../values/negate";

export const intersectGuards = (left: SymbolicValue[], right: SymbolicValue[]): SymbolicValue[] => {
  const rightKeys = new Set(right.map(getValueKey));
  return left.filter((guard) => rightKeys.has(getValueKey(guard)));
};

export const getRenderGuards = (
  render: SymbolicValue,
): Map<JsxExpressionValue, SymbolicValue[]> => {
  const guardsByNode = new Map<SymbolicValue, SymbolicValue[]>();
  const guardsByElement = new Map<JsxExpressionValue, SymbolicValue[]>();
  const walk = (node: SymbolicValue, guards: SymbolicValue[]): void => {
    const previousGuards = guardsByNode.get(node);
    const nodeGuards = previousGuards ? intersectGuards(previousGuards, guards) : guards;
    if (previousGuards && nodeGuards.length === previousGuards.length) return;
    guardsByNode.set(node, nodeGuards);
    if (node.kind === "Conditional") {
      const test = getTestExpression(node);
      walk(node.consequent, [...nodeGuards, test]);
      walk(node.alternate, [...nodeGuards, negate(test)]);
      return;
    }
    if (node.kind === "JsxExpression") {
      guardsByElement.set(node, nodeGuards);
      forEachPropNode(node, (propNode) => walk(propNode, nodeGuards));
    }
    getRenderChildren(node).forEach((child) => walk(child, nodeGuards));
  };
  walk(render, []);
  return guardsByElement;
};

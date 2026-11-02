import type { JsxExpressionValue, SymbolicValue } from "../types";
import { getMemoizedRender } from "../render/get-memoized-render";
import { forEachPropNode } from "../render/for-each-jsx-element";
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
    switch (node.kind) {
      case "JsxExpression":
        guardsByElement.set(node, nodeGuards);
        forEachPropNode(node, (propNode) => walk(propNode, nodeGuards));
        node.children.forEach((child) => walk(child, nodeGuards));
        return;
      case "JsxFragment":
        node.children.forEach((child) => walk(child, nodeGuards));
        return;
      case "ArrayMap":
        walk(node.item, nodeGuards);
        return;
      case "ArrayExpression":
        [...node.elements, ...node.spreads].forEach((element) => walk(element, nodeGuards));
        return;
      case "Conditional": {
        const test = getTestExpression(node);
        walk(node.consequent, [...nodeGuards, test]);
        walk(node.alternate, [...nodeGuards, negate(test)]);
        return;
      }
      case "Binding": {
        const memoized = getMemoizedRender(node);
        if (memoized) walk(memoized, nodeGuards);
        return;
      }
      default:
        return;
    }
  };
  walk(render, []);
  return guardsByElement;
};

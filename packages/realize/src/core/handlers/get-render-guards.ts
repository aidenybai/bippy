import type { JsxExpressionValue, SymbolicValue } from "../types";
import { getMemoizedRender } from "../states/get-memoized-render";
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
        for (const prop of node.props)
          if (prop.kind === "JsxAttribute") walkPropValue(prop.value, nodeGuards);
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
  const walkPropValue = (value: SymbolicValue, guards: SymbolicValue[]): void => {
    switch (value.kind) {
      case "ArrayExpression":
        value.elements.forEach((element) => walkPropValue(element, guards));
        return;
      case "ObjectExpression":
        for (const property of value.properties) walkPropValue(property.value, guards);
        return;
      default:
        walk(value, guards);
    }
  };
  walk(render, []);
  return guardsByElement;
};

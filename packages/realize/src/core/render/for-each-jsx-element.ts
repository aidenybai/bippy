import type { SymbolicValue, JsxExpressionValue } from "../types";
import { forEachRenderNode } from "./for-each-render-node";

export const forEachPropNode = (
  element: JsxExpressionValue,
  visit: (node: SymbolicValue) => void,
): void => {
  const walk = (value: SymbolicValue): void => {
    switch (value.kind) {
      case "ArrayExpression":
        value.elements.forEach(walk);
        return;
      case "ObjectExpression":
        for (const property of value.properties) walk(property.value);
        return;
      default:
        visit(value);
    }
  };
  for (const prop of element.props) if (prop.kind === "JsxAttribute") walk(prop.value);
};

export const forEachJsxElement = (
  value: SymbolicValue,
  visit: (element: JsxExpressionValue) => void,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const walk = (root: SymbolicValue): void =>
    forEachRenderNode(root, (node) => {
      if (node.kind !== "JsxExpression" || visited.has(node)) return;
      visited.add(node);
      visit(node);
      forEachPropNode(node, walk);
    });
  walk(value);
};

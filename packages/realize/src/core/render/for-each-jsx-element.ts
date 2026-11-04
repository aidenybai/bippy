import type { SymbolicValue, JsxExpressionValue } from "../types";
import { forEachRenderNode } from "./for-each-render-node";
import { getContainedValues } from "../values/symbolic-values";

export const forEachPropNode = (
  element: JsxExpressionValue,
  visit: (node: SymbolicValue) => void,
): void => {
  for (const prop of element.props)
    if (prop.kind === "JsxAttribute") getContainedValues(prop.value).forEach(visit);
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

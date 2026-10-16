import type { SymbolicValue, JsxExpressionValue } from "../types";
import { forEachRenderNode } from "./for-each-render-node";

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
      for (const prop of node.props) if (prop.kind === "JsxAttribute") walk(prop.value);
    });
  walk(value);
};

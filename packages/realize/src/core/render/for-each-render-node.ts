import type { SymbolicValue } from "../types";
import { getMemoizedRender } from "./get-memoized-render";

export const forEachRenderNode = (
  value: SymbolicValue,
  visit: (node: SymbolicValue) => void,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const walk = (node: SymbolicValue): void => {
    if (visited.has(node)) return;
    visited.add(node);
    visit(node);
    switch (node.kind) {
      case "JsxExpression":
      case "JsxFragment":
        node.children.forEach(walk);
        return;
      case "Conditional":
        walk(node.consequent);
        walk(node.alternate);
        return;
      case "ArrayMap":
        walk(node.item);
        return;
      case "ArrayExpression":
        node.elements.forEach(walk);
        node.spreads.forEach(walk);
        return;
      case "Binding": {
        const memoized = getMemoizedRender(node);
        if (memoized) walk(memoized);
        return;
      }
      default:
        return;
    }
  };
  walk(value);
};

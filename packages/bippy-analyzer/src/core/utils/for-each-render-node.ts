import type { SymbolicValue } from "../types";

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
      default:
        return;
    }
  };
  walk(value);
};

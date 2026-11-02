import type { SymbolicValue } from "../types";
import { getRenderChildren } from "./get-render-children";

export const forEachRenderNode = (
  value: SymbolicValue,
  visit: (node: SymbolicValue) => void,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const walk = (node: SymbolicValue): void => {
    if (visited.has(node)) return;
    visited.add(node);
    visit(node);
    getRenderChildren(node).forEach(walk);
  };
  walk(value);
};

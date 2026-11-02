import type { SymbolicValue } from "../types";
import { getMemoizedRender } from "./get-memoized-render";

export const getRenderChildren = (node: SymbolicValue): SymbolicValue[] => {
  switch (node.kind) {
    case "JsxExpression":
    case "JsxFragment":
      return node.children;
    case "Conditional":
      return [node.consequent, node.alternate];
    case "ArrayMap":
      return [node.item];
    case "ArrayExpression":
      return [...node.elements, ...node.spreads];
    case "Binding": {
      const memoized = getMemoizedRender(node);
      return memoized ? [memoized] : [];
    }
    default:
      return [];
  }
};

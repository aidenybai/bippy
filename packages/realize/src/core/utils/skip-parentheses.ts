import type { Node } from "typescript/unstable/ast";
import { isParenthesizedExpression } from "typescript/unstable/ast/is";

export const skipParentheses = (node: Node): Node =>
  isParenthesizedExpression(node) ? skipParentheses(node.expression) : node;

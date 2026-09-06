import type { Node } from "oxc-parser";

export const isAstNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

export const isFunctionLikeNode = (node: Node): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "ClassDeclaration" ||
  node.type === "ClassExpression";

export const forEachChildNode = (node: Node, visit: (child: Node) => void): void => {
  for (const [key, child] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(child)) {
      for (const item of child) if (isAstNode(item)) visit(item);
    } else if (isAstNode(child)) {
      visit(child);
    }
  }
};

/**
 * Depth-first search for a node satisfying `predicate`. `enter` decides whether
 * a subtree is descended into at all (e.g. to stop at nested function bodies).
 */
export const someNode = (
  root: Node,
  predicate: (node: Node) => boolean,
  enter: (node: Node) => boolean = () => true,
): boolean => {
  if (predicate(root)) return true;
  if (!enter(root)) return false;
  let found = false;
  forEachChildNode(root, (child) => {
    if (!found) found = someNode(child, predicate, enter);
  });
  return found;
};

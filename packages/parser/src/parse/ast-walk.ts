import type { Expression, Node, Statement, StringLiteral } from "oxc-parser";
import type { FunctionLikeNode } from "../types.js";

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

/** Strips parentheses and TypeScript-only wrappers that do not change the runtime value. */
export const unwrapExpression = (node: Expression): Expression => {
  switch (node.type) {
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "TSInstantiationExpression":
      return unwrapExpression(node.expression);
    default:
      return node;
  }
};

/** `["a", "b", "c"]` for `a.b.c` (non-computed identifiers only); null for any other shape. */
export const getMemberChain = (node: Expression): string[] | null => {
  const unwrapped = unwrapExpression(node);
  if (unwrapped.type === "Identifier") return [unwrapped.name];
  if (unwrapped.type === "ThisExpression") return ["this"];
  if (unwrapped.type !== "MemberExpression" || unwrapped.computed) return null;
  if (unwrapped.property.type !== "Identifier") return null;
  const objectChain = getMemberChain(unwrapped.object);
  return objectChain ? [...objectChain, unwrapped.property.name] : null;
};

export const isStringLiteralNode = (node: Node | null | undefined): node is StringLiteral =>
  node?.type === "Literal" && typeof node.value === "string";

export const isFunctionLikeExpression = (node: Node | null | undefined): node is FunctionLikeNode =>
  node?.type === "FunctionExpression" || node?.type === "ArrowFunctionExpression";

/** The statements of a function body; null for an arrow with an expression body. */
export const getFunctionStatements = (node: FunctionLikeNode): Statement[] | null => {
  if (!node.body || node.body.type !== "BlockStatement") return null;
  return node.body.body;
};

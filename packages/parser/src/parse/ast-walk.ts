import { visitorKeys } from "oxc-parser";
import type { BindingPattern, Expression, Node, Statement, StringLiteral } from "oxc-parser";
import type { FunctionLikeNode } from "../types.js";

export interface ChildNodeVisitor {
  (child: Node, key: string, index: number): void;
}

export const isAstNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

export const isFunctionLikeNode = (node: Node): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "ClassDeclaration" ||
  node.type === "ClassExpression";

export const forEachChildNode = (node: Node, visit: ChildNodeVisitor): void => {
  const childKeys = visitorKeys[node.type] ?? [];
  for (const [key, child] of Object.entries(node)) {
    if (!childKeys.includes(key)) continue;
    if (Array.isArray(child)) {
      child.forEach((item, index) => {
        if (isAstNode(item)) visit(item, key, index);
      });
    } else if (isAstNode(child)) {
      visit(child, key, 0);
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

export const getPatternNames = (pattern: BindingPattern): string[] => {
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((property) =>
        getPatternNames(property.type === "RestElement" ? property.argument : property.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((element) =>
        element ? getPatternNames(element.type === "RestElement" ? element.argument : element) : [],
      );
    case "AssignmentPattern":
      return getPatternNames(pattern.left);
  }
};

/** Names `var` declares anywhere in a function body (nested functions excluded); they belong to the function scope. */
export const getHoistedVarNames = (statements: Statement[]): string[] => {
  const names: string[] = [];
  const visit = (node: Node): void => {
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      for (const declarator of node.declarations) names.push(...getPatternNames(declarator.id));
    }
    if (!isFunctionLikeNode(node)) forEachChildNode(node, visit);
  };
  statements.forEach(visit);
  return names;
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

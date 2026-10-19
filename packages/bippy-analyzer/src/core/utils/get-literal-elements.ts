import type { Expression, Node } from "typescript/unstable/ast";
import { NodeFlags } from "typescript/unstable/ast";
import {
  isArrayLiteralExpression,
  isAsExpression,
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isNumericLiteral,
  isParenthesizedExpression,
  isSatisfiesExpression,
  isStringLiteral,
  isVariableDeclaration,
  isVariableDeclarationList,
} from "typescript/unstable/ast/is";
import type { Checker } from "typescript/unstable/sync";
import { resolveSymbol } from "./typescript";

const unwrapExpression = (node: Node): Node =>
  isParenthesizedExpression(node) ||
  isAsExpression(node) ||
  isSatisfiesExpression(node) ||
  isNonNullExpression(node)
    ? unwrapExpression(node.expression)
    : node;

const getLiteral = (element: Expression): string | number | null => {
  if (isStringLiteral(element) || isNoSubstitutionTemplateLiteral(element)) return element.text;
  return isNumericLiteral(element) ? Number(element.text) : null;
};

const getConstantInitializer = (checker: Checker, node: Node): Node | null => {
  const declaration = resolveSymbol(checker, node)?.valueDeclaration?.resolve();
  if (!declaration || !isVariableDeclaration(declaration) || !declaration.initializer) return null;
  const list = declaration.parent;
  return isVariableDeclarationList(list) && list.flags & NodeFlags.Const
    ? unwrapExpression(declaration.initializer)
    : null;
};

export const getLiteralElements = (checker: Checker, node: Node): Array<string | number> | null => {
  const initializer = getConstantInitializer(checker, unwrapExpression(node));
  if (!initializer || !isArrayLiteralExpression(initializer)) return null;
  const literals = initializer.elements.map(getLiteral);
  return literals.every((literal) => literal !== null)
    ? literals.flatMap((literal) => literal ?? [])
    : null;
};

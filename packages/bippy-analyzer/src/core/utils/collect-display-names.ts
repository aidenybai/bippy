import type { SourceFile } from "typescript/unstable/ast";
import {
  isExpressionStatement,
  isBinaryExpression,
  isPropertyAccessExpression,
  isIdentifier,
  isStringLiteral,
} from "typescript/unstable/ast/is";
import { SyntaxKind } from "typescript/unstable/ast";
import { skipParentheses } from "./skip-parentheses";

export const collectDisplayNames = (sourceFile: SourceFile): Map<string, string | null> => {
  const displayNames = new Map<string, string | null>();
  for (const statement of sourceFile.statements) {
    if (!isExpressionStatement(statement)) continue;
    const expression = skipParentheses(statement.expression);
    if (!isBinaryExpression(expression) || expression.operatorToken.kind !== SyntaxKind.EqualsToken)
      continue;
    const { left, right } = expression;
    if (
      isPropertyAccessExpression(left) &&
      left.name.text === "displayName" &&
      isIdentifier(left.expression)
    ) {
      displayNames.set(left.expression.text, isStringLiteral(right) ? right.text : null);
    }
  }
  return displayNames;
};

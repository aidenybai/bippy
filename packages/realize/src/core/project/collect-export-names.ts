import type { Node, SourceFile } from "typescript/unstable/ast";
import { SyntaxKind } from "typescript/unstable/ast";
import {
  isClassDeclaration,
  isFunctionDeclaration,
  isVariableStatement,
  isIdentifier,
  isExportAssignment,
  isExportDeclaration,
  isNamedExports,
} from "typescript/unstable/ast/is";
import { skipParentheses } from "./skip-parentheses";

const hasModifier = (node: Node, kind: SyntaxKind): boolean =>
  "modifiers" in node &&
  Array.isArray(node.modifiers) &&
  node.modifiers.some((modifier: Node) => modifier.kind === kind);

export const collectExportNames = (sourceFile: SourceFile): Map<string, string> => {
  const exportNames = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    const isExported = hasModifier(statement, SyntaxKind.ExportKeyword);
    if ((isFunctionDeclaration(statement) || isClassDeclaration(statement)) && isExported) {
      const name = statement.name?.text ?? "default";
      exportNames.set(name, hasModifier(statement, SyntaxKind.DefaultKeyword) ? "default" : name);
    }
    if (isVariableStatement(statement) && isExported) {
      for (const declaration of statement.declarationList.declarations) {
        if (isIdentifier(declaration.name))
          exportNames.set(declaration.name.text, declaration.name.text);
      }
    }
    if (isExportAssignment(statement)) {
      const expression = skipParentheses(statement.expression);
      exportNames.set(isIdentifier(expression) ? expression.text : "default", "default");
    }
    if (
      isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) {
        exportNames.set(
          specifier.propertyName?.getText(sourceFile) ?? specifier.name.getText(sourceFile),
          specifier.name.getText(sourceFile),
        );
      }
    }
  }
  return exportNames;
};

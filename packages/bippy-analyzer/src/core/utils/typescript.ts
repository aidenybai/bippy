import { SyntaxKind } from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import type { Checker, Type } from "typescript/unstable/sync";
import { SymbolFlags } from "typescript/unstable/sync";
import { GeneratedSource } from "../../react-compiler/HIR/HIR.js";
import type { SourceLocation } from "../../react-compiler/HIR/HIR.js";

const REACT_DECLARATION_PATTERN = /[\\/]node_modules[\\/](?:@types[\\/])?react[\\/]/;
const REACT_ELEMENT_TYPE_NAMES = new Set(["ReactElement", "ReactPortal", "ReactNode", "Element"]);

export const isReactElementType = (type: Type): boolean =>
  (type.isUnionType() ? type.getTypes() : [type]).some((member) => {
    const symbol = member.getSymbol();
    return (
      symbol !== undefined &&
      REACT_ELEMENT_TYPE_NAMES.has(symbol.name) &&
      symbol.declarations.some((declaration) => REACT_DECLARATION_PATTERN.test(declaration.path))
    );
  });

const skipParentheses = (node: Node): Node =>
  t.isParenthesizedExpression(node) ? skipParentheses(node.expression) : node;

const nodeIndexes = new WeakMap<SourceFile, Map<string, Node>>();

const getRangeKey = (start: number, end: number): string => `${start}:${end}`;

const getNodeIndex = (sourceFile: SourceFile): Map<string, Node> => {
  let index = nodeIndexes.get(sourceFile);
  if (!index) {
    const nodes = new Map<string, Node>();
    const visit = (node: Node): void => {
      nodes.set(getRangeKey(node.getStart(sourceFile), node.getEnd()), node);
      node.forEachChild(visit);
    };
    sourceFile.forEachChild(visit);
    index = nodes;
    nodeIndexes.set(sourceFile, index);
  }
  return index;
};

export const findNodeAtLocation = (sourceFile: SourceFile, loc: SourceLocation): Node | null =>
  loc === GeneratedSource
    ? null
    : (getNodeIndex(sourceFile).get(getRangeKey(loc.start.index, loc.end.index)) ?? null);

const resolveSymbol = (checker: Checker, node: Node) => {
  const nameNode = t.isPropertyAccessExpression(node) ? node.name : node;
  if (!t.isIdentifier(nameNode)) return null;
  const symbol = checker.getSymbolAtLocation(nameNode);
  if (!symbol) return null;
  return symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
};

export const getDeclarationKey = (checker: Checker, node: Node): string | null => {
  const target = resolveSymbol(checker, node);
  const [declaration] = target?.declarations ?? [];
  if (!target) return null;
  return declaration ? `${declaration.path}#${target.name}` : null;
};

// React 19 renders a context itself as its provider.
export const getContextKey = (checker: Checker, node: Node): string | null =>
  t.isPropertyAccessExpression(node) && node.name.text === "Provider"
    ? getDeclarationKey(checker, node.expression)
    : getDeclarationKey(checker, node);

export const getReactExportName = (checker: Checker, node: Node): string | null => {
  const target = resolveSymbol(checker, node);
  return target?.declarations.some((declaration) =>
    REACT_DECLARATION_PATTERN.test(declaration.path),
  )
    ? target.name
    : null;
};

const hasModifier = (node: Node, kind: SyntaxKind): boolean =>
  "modifiers" in node &&
  Array.isArray(node.modifiers) &&
  node.modifiers.some((modifier: Node) => modifier.kind === kind);

export const collectExportNames = (sourceFile: SourceFile): Map<string, string> => {
  const exportNames = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    const isExported = hasModifier(statement, SyntaxKind.ExportKeyword);
    if (t.isFunctionDeclaration(statement) && isExported) {
      const name = statement.name?.text ?? "default";
      exportNames.set(name, hasModifier(statement, SyntaxKind.DefaultKeyword) ? "default" : name);
    }
    if (t.isVariableStatement(statement) && isExported) {
      for (const declaration of statement.declarationList.declarations) {
        if (t.isIdentifier(declaration.name))
          exportNames.set(declaration.name.text, declaration.name.text);
      }
    }
    if (t.isExportAssignment(statement)) {
      const expression = skipParentheses(statement.expression);
      exportNames.set(t.isIdentifier(expression) ? expression.text : "default", "default");
    }
    if (
      t.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      t.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportNames.set(
          element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile),
          element.name.getText(sourceFile),
        );
      }
    }
  }
  return exportNames;
};

export const collectDisplayNames = (sourceFile: SourceFile): Map<string, string | null> => {
  const displayNames = new Map<string, string | null>();
  for (const statement of sourceFile.statements) {
    if (!t.isExpressionStatement(statement)) continue;
    const expression = skipParentheses(statement.expression);
    if (
      !t.isBinaryExpression(expression) ||
      expression.operatorToken.kind !== SyntaxKind.EqualsToken
    )
      continue;
    const { left, right } = expression;
    if (
      t.isPropertyAccessExpression(left) &&
      left.name.text === "displayName" &&
      t.isIdentifier(left.expression)
    ) {
      displayNames.set(left.expression.text, t.isStringLiteral(right) ? right.text : null);
    }
  }
  return displayNames;
};

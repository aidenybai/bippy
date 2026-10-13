import { SyntaxKind } from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";
import {
  isBinaryExpression,
  isExportAssignment,
  isExportDeclaration,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isNamedExports,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableStatement,
} from "typescript/unstable/ast/is";
import type { Checker, Type } from "typescript/unstable/sync";
import { SymbolFlags } from "typescript/unstable/sync";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceLocation } from "../../react-compiler/HIR/HIR";

const REACT_DECLARATION_PATTERN = /[\\/]node_modules[\\/](?:@types[\\/])?react(?:-dom)?[\\/]/;
const REACT_ELEMENT_TYPE_PATTERN = /^(?:ReactElement|ReactPortal|ReactNode|Element)$/;

const LIBRARY_DECLARATION_PATTERN = /[\\/]lib\.[\w.]+\.d\.ts$/;

const isDeclaredType = (type: Type, namePattern: RegExp, declarationPattern: RegExp): boolean =>
  [type.getSymbol(), type.getAliasSymbol()].some(
    (symbol) =>
      symbol !== undefined &&
      namePattern.test(symbol.name) &&
      symbol.declarations.some((declaration) => declarationPattern.test(declaration.path)),
  );

export const isReactType = (type: Type, namePattern: RegExp): boolean =>
  isDeclaredType(type, namePattern, REACT_DECLARATION_PATTERN);

export const isLibraryType = (type: Type, namePattern: RegExp): boolean =>
  isDeclaredType(type, namePattern, LIBRARY_DECLARATION_PATTERN);

export const isReactElementType = (type: Type): boolean =>
  (type.isUnionType() ? type.getTypes() : [type]).some((member) =>
    isReactType(member, REACT_ELEMENT_TYPE_PATTERN),
  );

const skipParentheses = (node: Node): Node =>
  isParenthesizedExpression(node) ? skipParentheses(node.expression) : node;

const nodesByRangeCache = new WeakMap<SourceFile, Map<string, Node>>();

const getRangeKey = (start: number, end: number): string => `${start}:${end}`;

const getNodesByRange = (sourceFile: SourceFile): Map<string, Node> => {
  const cachedNodes = nodesByRangeCache.get(sourceFile);
  if (cachedNodes) return cachedNodes;
  const nodesByRange = new Map<string, Node>();
  const visit = (node: Node): void => {
    nodesByRange.set(getRangeKey(node.getStart(sourceFile), node.getEnd()), node);
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  nodesByRangeCache.set(sourceFile, nodesByRange);
  return nodesByRange;
};

export const findNodeAtLocation = (sourceFile: SourceFile, loc: SourceLocation): Node | null =>
  loc === GeneratedSource
    ? null
    : (getNodesByRange(sourceFile).get(getRangeKey(loc.start.index, loc.end.index)) ?? null);

const resolveSymbol = (checker: Checker, node: Node) => {
  const nameNode = isPropertyAccessExpression(node) ? node.name : node;
  if (!isIdentifier(nameNode)) return null;
  const symbol = checker.getSymbolAtLocation(nameNode);
  if (!symbol) return null;
  return symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
};

export const getDeclarationKey = (checker: Checker, node: Node): string | null => {
  const symbol = resolveSymbol(checker, node);
  const [declaration] = symbol?.declarations ?? [];
  return symbol && declaration ? `${declaration.path}#${symbol.name}` : null;
};

export const getContextKey = (checker: Checker, node: Node): string | null =>
  isPropertyAccessExpression(node) && node.name.text === "Provider"
    ? getDeclarationKey(checker, node.expression)
    : getDeclarationKey(checker, node);

export const getReactExportName = (checker: Checker, node: Node): string | null => {
  const symbol = resolveSymbol(checker, node);
  return symbol?.declarations.some((declaration) =>
    REACT_DECLARATION_PATTERN.test(declaration.path),
  )
    ? symbol.name
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
    if (isFunctionDeclaration(statement) && isExported) {
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

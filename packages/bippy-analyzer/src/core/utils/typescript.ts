import { SyntaxKind } from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import type { Checker, Type } from "typescript/unstable/sync";
import { SymbolFlags } from "typescript/unstable/sync";
import { isComponentFunction, skipParentheses } from "../../compiler/program.js";
import type { ComponentFunction } from "../../compiler/program.js";
import { GeneratedSource } from "../../compiler/hir/hir.js";
import type { SourceLocation } from "../../compiler/hir/hir.js";

const REACT_DECLARATION_PATTERN = /[\\/]node_modules[\\/](?:@types[\\/])?react[\\/]/;
const REACT_ELEMENT_TYPE_NAMES = new Set(["ReactElement", "ReactPortal", "ReactNode", "Element"]);

/**
 * Whether a value of this type can be React elements: the type, or a member of its union,
 * is one of React's element types as React's own typings declare it.
 */
export const isReactElementType = (type: Type): boolean =>
  (type.isUnionType() ? type.getTypes() : [type]).some((member) => {
    const symbol = member.getSymbol();
    return (
      symbol !== undefined &&
      REACT_ELEMENT_TYPE_NAMES.has(symbol.name) &&
      symbol.declarations.some((declaration) => REACT_DECLARATION_PATTERN.test(declaration.path))
    );
  });

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

/**
 * Finds the TypeScript node a HIR location was lowered from: the innermost node whose
 * range is exactly `[start, end)`.
 */
export const findNodeAtLocation = (sourceFile: SourceFile, loc: SourceLocation): Node | null =>
  loc === GeneratedSource
    ? null
    : (getNodeIndex(sourceFile).get(getRangeKey(loc.start, loc.end)) ?? null);

/**
 * The symbol a reference, or the name of `a.b`, resolves to through import aliases.
 */
const resolveSymbol = (checker: Checker, node: Node) => {
  const nameNode = t.isPropertyAccessExpression(node) ? node.name : node;
  if (!t.isIdentifier(nameNode)) return null;
  const symbol = checker.getSymbolAtLocation(nameNode);
  if (!symbol) return null;
  return symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
};

/**
 * Identifies the declaration a reference resolves to, through imports and re-exports, as
 * `<file>#<name>`. Two components with the same name in different files stay distinct.
 */
export const getDeclarationKey = (checker: Checker, node: Node): string | null => {
  const target = resolveSymbol(checker, node);
  const [declaration] = target?.declarations ?? [];
  if (!target) return null;
  return declaration ? `${declaration.path}#${target.name}` : null;
};

/**
 * Gives the name React exports a reference under, following import aliases and re-exports
 * to React's own declarations. `React.useState`, `import { useState as useLocal }` and a
 * re-export from a local barrel all resolve to `useState`.
 */
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

/**
 * Maps each exported local name in a file to the name it is exported as.
 */
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

/**
 * The `displayName` each component is given. A name assigned from anything but a string
 * literal, like `Sheet.displayName = Dialog.displayName`, is known only at runtime: null.
 */
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

/**
 * Finds the function a module-level name is bound to, such as a reducer declared next to
 * the component that uses it.
 */
export const findModuleFunction = (
  sourceFile: SourceFile,
  name: string,
): ComponentFunction | null => {
  for (const statement of sourceFile.statements) {
    if (t.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (!t.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !t.isIdentifier(declaration.name) ||
        declaration.name.text !== name ||
        !declaration.initializer
      )
        continue;
      const initializer = skipParentheses(declaration.initializer);
      return isComponentFunction(initializer) ? initializer : null;
    }
  }
  return null;
};

import type { Node, SourceFile } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import type { Checker } from "typescript/unstable/sync";
import { SymbolFlags } from "typescript/unstable/sync";
import { GeneratedSource } from "../hir/hir.js";
import type { SourceLocation } from "../hir/hir.js";

const REACT_DECLARATION_PATTERN = /[\\/]node_modules[\\/](?:@types[\\/])?react[\\/]/;

/**
 * Finds the TypeScript node a HIR location was lowered from: the innermost node whose
 * range is exactly `[start, end)`.
 */
export const findNodeAtLocation = (sourceFile: SourceFile, loc: SourceLocation): Node | null => {
  if (loc === GeneratedSource) return null;
  let match: Node | null = null;
  const visit = (node: Node): void => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (start > loc.start || end < loc.end) return;
    if (start === loc.start && end === loc.end) match = node;
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return match;
};

/**
 * Gives the name React exports a reference under, following import aliases and re-exports
 * to React's own declarations. `React.useState`, `import { useState as useLocal }` and a
 * re-export from a local barrel all resolve to `useState`.
 */
export const getReactExportName = (checker: Checker, node: Node): string | null => {
  const nameNode = t.isPropertyAccessExpression(node) ? node.name : node;
  if (!t.isIdentifier(nameNode)) return null;
  const symbol = checker.getSymbolAtLocation(nameNode);
  if (!symbol) return null;
  const target = symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return target.declarations.some((declaration) => REACT_DECLARATION_PATTERN.test(declaration.path))
    ? target.name
    : null;
};

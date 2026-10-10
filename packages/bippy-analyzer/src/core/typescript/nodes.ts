import type { Node, SourceFile } from "typescript/unstable/ast";
import * as t from "typescript/unstable/ast/is";
import type { Checker, Type } from "typescript/unstable/sync";
import { SymbolFlags } from "typescript/unstable/sync";
import { GeneratedSource } from "../hir/hir.js";
import type { SourceLocation } from "../hir/hir.js";

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
 * Identifies the declaration a reference resolves to, through imports and re-exports, as
 * `<file>#<name>`. Two components with the same name in different files stay distinct.
 */
export const getDeclarationKey = (checker: Checker, node: Node): string | null => {
  const nameNode = t.isPropertyAccessExpression(node) ? node.name : node;
  if (!t.isIdentifier(nameNode)) return null;
  const symbol = checker.getSymbolAtLocation(nameNode);
  if (!symbol) return null;
  const target = symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const [declaration] = target.declarations;
  return declaration ? `${declaration.path}#${target.name}` : null;
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

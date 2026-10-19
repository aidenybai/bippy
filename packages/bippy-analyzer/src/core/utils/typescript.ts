import type { Type, Symbol, Checker } from "typescript/unstable/sync";
import type { Node } from "typescript/unstable/ast";
import { isPropertyAccessExpression, isIdentifier } from "typescript/unstable/ast/is";
import { SymbolFlags } from "typescript/unstable/sync";
import { createDeclarationKey } from "./declaration-key";
import { LIBRARY_DECLARATION_PATTERN } from "./library-declaration-pattern";

const REACT_DECLARATION_PATTERN = /[\\/]node_modules[\\/](?:@types[\\/])?react(?:-dom)?[\\/]/;

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

export const resolveSymbol = (checker: Checker, node: Node): Symbol | null => {
  const nameNode = isPropertyAccessExpression(node) ? node.name : node;
  if (!isIdentifier(nameNode)) return null;
  const symbol = checker.getSymbolAtLocation(nameNode);
  if (!symbol) return null;
  return symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
};

export const getDeclarationKey = (checker: Checker, node: Node): string | null => {
  const symbol = resolveSymbol(checker, node);
  const [declaration] = symbol?.declarations ?? [];
  return symbol && declaration ? createDeclarationKey(declaration.path, symbol.name) : null;
};

export const getReactExportName = (checker: Checker, node: Node): string | null => {
  const symbol = resolveSymbol(checker, node);
  return symbol?.declarations.some((declaration) =>
    REACT_DECLARATION_PATTERN.test(declaration.path),
  )
    ? symbol.name
    : null;
};

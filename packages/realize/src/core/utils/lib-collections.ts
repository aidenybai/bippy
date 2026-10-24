import type { SourceFile } from "typescript/unstable/ast";
import { SymbolFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { MutableCollection } from "../../react-compiler/HIR/Environment";
import { LIBRARY_DECLARATION_PATTERN } from "./library-declaration-pattern";

const LIB_COLLECTION_NAMES = new Map<string, MutableCollection>([
  ["Map", "Map"],
  ["ReadonlyMap", "Map"],
  ["Set", "Set"],
  ["ReadonlySet", "Set"],
]);

export const getCollectionName = (checker: Checker, type: Type): MutableCollection | null => {
  if (checker.isArrayType(type) || checker.isTupleType(type)) return "Array";
  const symbol = type.getSymbol();
  const isLibDeclared = symbol?.declarations.some((declaration) =>
    LIBRARY_DECLARATION_PATTERN.test(declaration.path),
  );
  return isLibDeclared ? (LIB_COLLECTION_NAMES.get(symbol?.name ?? "") ?? null) : null;
};

export const getInterfaceMemberNames = (
  checker: Checker,
  sourceFile: SourceFile,
  interfaceName: string,
): string[] => {
  const symbol = checker.resolveName(interfaceName, SymbolFlags.Type, sourceFile);
  if (!symbol) return [];
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  return checker.getPropertiesOfType(type).map((property) => property.name);
};

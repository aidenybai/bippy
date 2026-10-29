import type { SourceFile } from "typescript/unstable/ast";
import { SymbolFlags } from "typescript/unstable/sync";
import type { Checker, Type } from "typescript/unstable/sync";
import type { MutableCollection } from "../../react-compiler/HIR/Environment";
import { LIBRARY_DECLARATION_PATTERN } from "./library-declaration-pattern";
import { getPropertiesOfType, isArrayType, isTupleType } from "./checker-queries";

const LIB_COLLECTION_NAMES = new Map<string, MutableCollection>([
  ["Map", "Map"],
  ["ReadonlyMap", "Map"],
  ["Set", "Set"],
  ["ReadonlySet", "Set"],
]);

const collectionNames = new WeakMap<Type, MutableCollection | null>();

export const getCollectionName = (checker: Checker, type: Type): MutableCollection | null => {
  if (collectionNames.has(type)) return collectionNames.get(type) ?? null;
  const collectionName = getUncachedCollectionName(checker, type);
  collectionNames.set(type, collectionName);
  return collectionName;
};

const getUncachedCollectionName = (checker: Checker, type: Type): MutableCollection | null => {
  if (type.isTypeReference() && (isArrayType(checker, type) || isTupleType(checker, type)))
    return "Array";
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
  return getPropertiesOfType(checker, type).map((property) => property.name);
};

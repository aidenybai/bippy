import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import type { ImportedNames } from "../module-values";
import type { SourceFileResolver } from "../source-file-resolver";
import { parseDeclarationKey } from "./declaration-key";

export interface Importer {
  path: string;
  localName: string;
}

export interface ImportIndex {
  importers: Map<string, Importer[]>;
  exposedPaths: Set<string>;
}

const getModulePath = (resolver: SourceFileResolver, loc: SourceLocation): string | null => {
  const declarationKey = resolver.getDeclarationKey(loc);
  return declarationKey ? parseDeclarationKey(declarationKey).path : null;
};

export const createImportIndex = (
  importedNamesByPath: Map<string, ImportedNames>,
  getResolver: (path: string) => SourceFileResolver | undefined,
): ImportIndex => {
  const importers = new Map<string, Importer[]>();
  const reexportedPaths = new Map<string, string[]>();
  const namespacedPaths: string[] = [];
  for (const [path, imported] of importedNamesByPath) {
    const resolver = getResolver(path);
    if (!resolver) continue;
    for (const { localName, loc } of imported.specifiers) {
      const declarationKey = resolver.getDeclarationKey(loc);
      if (declarationKey)
        importers.set(declarationKey, [
          ...(importers.get(declarationKey) ?? []),
          { path, localName },
        ]);
    }
    for (const loc of imported.namespaceSources) {
      const modulePath = getModulePath(resolver, loc);
      if (modulePath) namespacedPaths.push(modulePath);
    }
    for (const loc of imported.reexportSources) {
      const modulePath = getModulePath(resolver, loc);
      if (modulePath) reexportedPaths.set(path, [...(reexportedPaths.get(path) ?? []), modulePath]);
    }
  }
  const exposedPaths = new Set<string>();
  const expose = (path: string): void => {
    if (exposedPaths.has(path)) return;
    exposedPaths.add(path);
    for (const reexportedPath of reexportedPaths.get(path) ?? []) expose(reexportedPath);
  };
  for (const path of namespacedPaths) expose(path);
  return { importers, exposedPaths };
};

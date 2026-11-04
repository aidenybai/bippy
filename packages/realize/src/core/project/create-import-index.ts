import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import { appendToGroup } from "../shared/append-to-group";
import type { SourceFileResolver } from "../type-checker/source-file-resolver";
import type { FileContext } from "./analyze-component";
import { parseDeclarationKey } from "./declaration-key";

interface Importer {
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

export const createImportIndex = (filesByPath: Map<string, FileContext>): ImportIndex => {
  const importers = new Map<string, Importer[]>();
  const reexportedPaths = new Map<string, string[]>();
  const namespacedPaths: string[] = [];
  for (const [path, file] of filesByPath) {
    const imported = file.compiled.moduleValues.importedNames;
    for (const specifier of imported.specifiers) {
      const declarationKey = file.resolver.getDeclarationKey(specifier.loc);
      if (declarationKey)
        appendToGroup(importers, declarationKey, { path, localName: specifier.localName });
    }
    for (const loc of imported.namespaceSources) {
      const modulePath = getModulePath(file.resolver, loc);
      if (modulePath) namespacedPaths.push(modulePath);
    }
    for (const loc of imported.reexportSources) {
      const modulePath = getModulePath(file.resolver, loc);
      if (modulePath) appendToGroup(reexportedPaths, path, modulePath);
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

import { getSourceLanguage, SourceFileCache } from "../parse/parse-source-file.js";
import type {
  BuiltinModuleResolution,
  ExternalModuleResolution,
  ImportBinding,
  ImportedName,
  ModuleLayer,
  ModuleRecord,
  ModuleResolution,
  ResolvedSymbol,
} from "../types.js";
import { isModeledLibraryExport, isModeledLibraryPackage } from "../libraries/index.js";
import { isPurePackage } from "../libraries/pure-packages.js";
import { isAssetImport, isUrlImport } from "./asset-module.js";
import { readAssetModuleSource } from "./asset-modules.js";
import { isCssModulePath } from "./css-module.js";
import { isCompilerHelperPackage } from "./helper-packages.js";
import { createModuleRecord, getModuleKey } from "./module-record.js";
import { ModuleResolver } from "./module-resolver.js";

interface ExportNameSet {
  names: string[];
  complete: boolean;
}

export interface ModuleGraphOptions {
  resolver: ModuleResolver;
  sourceFileCache?: SourceFileCache;
  resolveExternalPackages?: boolean;
  externalPackageAllowList?: string[];
  /** React Server Components: entry modules and everything they import outside a `"use client"` boundary live in the `react-server` layer. */
  serverComponents?: boolean;
}

const describeImportedName = (imported: ImportedName): string => {
  switch (imported.kind) {
    case "default":
      return "default";
    case "namespace":
      return "*";
    case "named":
      return imported.name;
  }
};

export class ModuleGraph {
  readonly resolver: ModuleResolver;
  readonly sourceFileCache: SourceFileCache;
  private readonly modules = new Map<string, ModuleRecord | null>();
  private readonly resolveExternalPackages: boolean;
  private readonly entryLayer: ModuleLayer;
  private readonly externalPackageAllowList: Set<string>;
  private readonly externalScopeAllowList: Set<string>;
  /** `prefix-*` entries: unscoped workspace packages sharing a name prefix. */
  private readonly externalPackagePrefixes: string[];

  constructor(options: ModuleGraphOptions) {
    this.resolver = options.resolver;
    this.sourceFileCache = options.sourceFileCache ?? new SourceFileCache();
    this.resolveExternalPackages = options.resolveExternalPackages ?? false;
    this.entryLayer = options.serverComponents ? "react-server" : "client";
    const allowList = options.externalPackageAllowList ?? [];
    this.externalPackageAllowList = new Set(allowList.filter((name) => !name.endsWith("*")));
    this.externalScopeAllowList = new Set(
      allowList.filter((name) => name.endsWith("/*")).map((name) => name.slice(0, -2)),
    );
    this.externalPackagePrefixes = allowList
      .filter((name) => name.endsWith("*") && !name.endsWith("/*"))
      .map((name) => name.slice(0, -1));
  }

  get loadedModuleCount(): number {
    const records = new Set<ModuleRecord>();
    for (const record of this.modules.values()) if (record) records.add(record);
    return records.size;
  }

  /** The module as instantiated in `importerLayer` (an entry module's layer when omitted). */
  getModule(filePath: string, importerLayer = this.entryLayer): ModuleRecord | null {
    return this.loadModule(filePath, importerLayer, () => {
      const file = this.sourceFileCache.read(filePath);
      return file ? createModuleRecord(file, importerLayer) : null;
    });
  }

  /** A module from source text rather than disk; a path already added is returned as is. */
  addVirtualModule(
    filePath: string,
    sourceText: string,
    importerLayer = this.entryLayer,
  ): ModuleRecord | null {
    return this.loadModule(filePath, importerLayer, () => {
      const lang = getSourceLanguage(filePath);
      if (!lang) return null;
      const file = this.sourceFileCache.readVirtual(filePath, sourceText, lang);
      return file.errors.length === 0 ? createModuleRecord(file, importerLayer) : null;
    });
  }

  /** A `"use client"` module reached from the server layer is the client layer's instance. */
  private loadModule(
    filePath: string,
    importerLayer: ModuleLayer,
    create: () => ModuleRecord | null,
  ): ModuleRecord | null {
    const requestedKey = getModuleKey(importerLayer, filePath);
    const cached = this.modules.get(requestedKey);
    if (cached !== undefined) return cached;
    let record = create();
    if (record && record.layer !== importerLayer) {
      const boundaryKey = getModuleKey(record.layer, filePath);
      record = this.modules.get(boundaryKey) ?? record;
      this.modules.set(boundaryKey, record);
    }
    this.modules.set(requestedKey, record);
    return record;
  }

  resolveSpecifier(specifier: string, fromModule: ModuleRecord): ModuleResolution {
    return this.resolver.resolve(
      specifier,
      fromModule.filePath,
      fromModule.isCommonJs ? "commonjs" : "esm",
      fromModule.layer,
    );
  }

  resolveImportedModule(
    specifier: string,
    fromModule: ModuleRecord,
  ): ModuleRecord | ModuleResolution {
    return this.getResolvedModule(
      this.resolveSpecifier(specifier, fromModule),
      specifier,
      fromModule.layer,
    );
  }

  private getResolvedModule(
    resolution: ModuleResolution,
    specifier: string,
    importerLayer: ModuleLayer,
  ): ModuleRecord | ModuleResolution {
    if (resolution.kind !== "internal" && resolution.kind !== "external") return resolution;
    if (resolution.filePath === null) return resolution;
    const assetModule = this.getAssetModule(resolution.filePath, specifier, importerLayer);
    if (assetModule) return assetModule;
    if (isUrlImport(specifier)) return resolution;
    if (resolution.kind === "external" && !this.shouldAnalyzePackage(resolution.packageName)) {
      return resolution;
    }
    return this.getModule(resolution.filePath, importerLayer) ?? resolution;
  }

  private getAssetModule(
    filePath: string,
    specifier: string,
    importerLayer: ModuleLayer,
  ): ModuleRecord | null {
    if (!specifier.includes("?")) return null;
    const source = readAssetModuleSource(filePath, specifier);
    if (!source) return null;
    return this.loadModule(source.moduleKey, importerLayer, () =>
      createModuleRecord(
        this.sourceFileCache.readVirtual(source.moduleKey, source.sourceText, "js"),
        importerLayer,
      ),
    );
  }

  resolveImport(binding: ImportBinding, fromModule: ModuleRecord): ResolvedSymbol {
    return this.resolveImportedSymbol(binding.specifier, binding.imported, fromModule);
  }

  resolveImportedSymbol(
    specifier: string,
    imported: ImportedName,
    fromModule: ModuleRecord,
  ): ResolvedSymbol {
    return this.resolveImportedName(specifier, imported, fromModule, new Set());
  }

  resolveLocalName(module: ModuleRecord, localName: string): ResolvedSymbol {
    return this.resolveLocalNameWithVisited(module, localName, new Set());
  }

  resolveExport(module: ModuleRecord, exportedName: string): ResolvedSymbol {
    return this.resolveExportWithVisited(module, exportedName, new Set());
  }

  listExportNames(module: ModuleRecord): string[] {
    return this.collectExportNames(module, new Set()).names;
  }

  /** Export names plus whether an `export *` from an unanalyzed module may add more. */
  collectExportNames(module: ModuleRecord, visited = new Set<string>()): ExportNameSet {
    const visitKey = getModuleKey(module.layer, module.filePath);
    if (visited.has(visitKey)) return { names: [], complete: true };
    visited.add(visitKey);
    const names = new Set<string>();
    let complete = true;
    for (const entry of module.exports) {
      if (entry.kind === "re-export-all") {
        const target = this.resolveImportedModule(entry.specifier, module);
        if (isModuleRecord(target)) {
          const nested = this.collectExportNames(target, visited);
          complete &&= nested.complete;
          for (const name of nested.names) {
            if (name !== "default") names.add(name);
          }
        } else {
          complete = false;
        }
        continue;
      }
      names.add(entry.exportedName);
    }
    return { names: [...names], complete };
  }

  private shouldAnalyzePackage(packageName: string): boolean {
    if (isCompilerHelperPackage(packageName) || isModeledLibraryPackage(packageName)) return false;
    if (
      this.externalPackageAllowList.has(packageName) ||
      this.externalScopeAllowList.has(packageName.split("/")[0]) ||
      this.externalPackagePrefixes.some((prefix) => packageName.startsWith(prefix))
    ) {
      return true;
    }
    return this.resolveExternalPackages && !isPurePackage(packageName);
  }

  private resolveImportedName(
    specifier: string,
    imported: ImportedName,
    fromModule: ModuleRecord,
    visited: Set<string>,
  ): ResolvedSymbol {
    const resolution = this.resolveSpecifier(specifier, fromModule);
    if (
      resolution.kind === "external" &&
      imported.kind !== "namespace" &&
      isModeledLibraryExport(specifier, describeImportedName(imported))
    ) {
      return externalSymbol(resolution, imported, specifier, fromModule.layer);
    }
    const target = this.getResolvedModule(resolution, specifier, fromModule.layer);
    if (isModuleRecord(target)) {
      if (imported.kind === "namespace") return { kind: "namespace", module: target };
      return this.resolveExportFrom(target, describeImportedName(imported), fromModule, visited);
    }
    if (
      (target.kind === "internal" || target.kind === "external") &&
      target.filePath !== null &&
      isAssetImport(target.filePath, specifier)
    ) {
      return { kind: "asset", filePath: target.filePath, specifier, imported };
    }
    switch (target.kind) {
      case "external":
      case "builtin":
        return externalSymbol(target, imported, specifier, fromModule.layer);
      case "internal":
        if (isCssModulePath(target.filePath)) {
          return { kind: "stylesheet", filePath: target.filePath, imported };
        }
        return { kind: "unresolved", reason: `unsupported module ${target.filePath}` };
      case "unresolved":
        return { kind: "unresolved", reason: `cannot resolve "${specifier}": ${target.error}` };
    }
  }

  private resolveLocalNameWithVisited(
    module: ModuleRecord,
    localName: string,
    visited: Set<string>,
  ): ResolvedSymbol {
    const binding = module.bindings.get(localName);
    if (!binding) {
      return {
        kind: "unresolved",
        reason: `no top-level binding "${localName}" in ${module.filePath}`,
      };
    }
    if (binding.kind === "import") {
      return this.resolveImportedName(
        binding.binding.specifier,
        binding.binding.imported,
        module,
        visited,
      );
    }
    return { kind: "binding", module, binding, isClientReference: false };
  }

  private resolveExportFrom(
    target: ModuleRecord,
    exportedName: string,
    fromModule: ModuleRecord,
    visited: Set<string>,
  ): ResolvedSymbol {
    const symbol = this.resolveExportWithVisited(target, exportedName, visited);
    return target.layer === "client" && fromModule.layer === "react-server"
      ? toClientReferenceSymbol(symbol)
      : symbol;
  }

  private resolveExportWithVisited(
    module: ModuleRecord,
    exportedName: string,
    visited: Set<string>,
  ): ResolvedSymbol {
    const visitKey = `${getModuleKey(module.layer, module.filePath)}\u0000${exportedName}`;
    if (visited.has(visitKey)) {
      return { kind: "unresolved", reason: `cyclic re-export of "${exportedName}"` };
    }
    visited.add(visitKey);
    for (const entry of module.exports) {
      switch (entry.kind) {
        case "local":
          if (entry.exportedName === exportedName) {
            return this.resolveLocalNameWithVisited(module, entry.localName, visited);
          }
          break;
        case "expression":
          if (entry.exportedName === exportedName) {
            if (entry.expression === module.moduleExports) {
              return { kind: "module-exports", module, exportedName, isClientReference: false };
            }
            return {
              kind: "expression",
              module,
              exportedName,
              expression: entry.expression,
              isClientReference: false,
            };
          }
          break;
        case "re-export":
          if (entry.exportedName === exportedName) {
            return this.resolveImportedName(entry.specifier, entry.imported, module, visited);
          }
          break;
        case "re-export-all":
          break;
      }
    }
    if (exportedName !== "default") {
      const externalSources: ResolvedSymbol[] = [];
      for (const entry of module.exports) {
        if (entry.kind !== "re-export-all") continue;
        if (isModeledLibraryExport(entry.specifier, exportedName)) {
          const resolution = this.resolveSpecifier(entry.specifier, module);
          if (resolution.kind === "external") {
            return externalSymbol(
              resolution,
              { kind: "named", name: exportedName },
              entry.specifier,
              module.layer,
            );
          }
        }
        const target = this.resolveImportedModule(entry.specifier, module);
        if (!isModuleRecord(target)) {
          if (target.kind === "external" || target.kind === "builtin") {
            externalSources.push(
              externalSymbol(
                target,
                { kind: "named", name: exportedName },
                entry.specifier,
                module.layer,
              ),
            );
          }
          continue;
        }
        const resolved = this.resolveExportFrom(target, exportedName, module, visited);
        if (resolved.kind !== "unresolved") return resolved;
      }
      if (externalSources.length === 1) return externalSources[0];
      if (externalSources.length > 1) {
        return {
          kind: "unresolved",
          reason: `"${exportedName}" may come from several external re-exports in ${module.filePath}`,
        };
      }
    }
    if (module.moduleExports) {
      return { kind: "module-exports", module, exportedName, isClientReference: false };
    }
    return { kind: "unresolved", reason: `no export "${exportedName}" in ${module.filePath}` };
  }
}

export const isModuleRecord = (value: ModuleRecord | ModuleResolution): value is ModuleRecord =>
  "bindings" in value;

const toClientReferenceSymbol = (symbol: ResolvedSymbol): ResolvedSymbol =>
  symbol.kind === "binding" || symbol.kind === "expression" || symbol.kind === "module-exports"
    ? { ...symbol, isClientReference: true }
    : symbol;

const externalSymbol = (
  target: ExternalModuleResolution | BuiltinModuleResolution,
  imported: ImportedName,
  specifier: string,
  layer: ModuleLayer,
): ResolvedSymbol => ({
  kind: "external",
  packageName: target.kind === "external" ? target.packageName : target.specifier,
  imported,
  specifier,
  filePath: target.kind === "external" ? target.filePath : null,
  layer,
});

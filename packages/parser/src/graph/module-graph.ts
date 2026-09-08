import { getSourceLanguage, SourceFileCache } from "../parse/parse-source-file.js";
import type {
  BuiltinModuleResolution,
  ExternalModuleResolution,
  ImportBinding,
  ImportedName,
  ModuleRecord,
  ModuleResolution,
  ResolvedSymbol,
} from "../types.js";
import { isModeledLibraryExport, isModeledLibraryPackage } from "../libraries/index.js";
import { isAssetPath } from "./asset-module.js";
import { readAssetModuleSource } from "./asset-modules.js";
import { isCssModulePath } from "./css-module.js";
import { isCompilerHelperPackage } from "./helper-packages.js";
import { createModuleRecord, isClientModule } from "./module-record.js";
import { ModuleResolver } from "./module-resolver.js";

export interface ExportNameSet {
  names: string[];
  complete: boolean;
}

export interface ModuleGraphOptions {
  resolver: ModuleResolver;
  sourceFileCache?: SourceFileCache;
  resolveExternalPackages?: boolean;
  externalPackageAllowList?: string[];
}

export const describeImportedName = (imported: ImportedName): string => {
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
  private readonly externalPackageAllowList: Set<string>;
  private readonly externalScopeAllowList: Set<string>;
  /** `prefix-*` entries: unscoped workspace packages sharing a name prefix. */
  private readonly externalPackagePrefixes: string[];

  constructor(options: ModuleGraphOptions) {
    this.resolver = options.resolver;
    this.sourceFileCache = options.sourceFileCache ?? new SourceFileCache();
    this.resolveExternalPackages = options.resolveExternalPackages ?? false;
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
    let count = 0;
    for (const record of this.modules.values()) if (record) count++;
    return count;
  }

  getModule(filePath: string): ModuleRecord | null {
    const cached = this.modules.get(filePath);
    if (cached !== undefined) return cached;
    const file = this.sourceFileCache.read(filePath);
    const record = file ? createModuleRecord(file) : null;
    this.modules.set(filePath, record);
    return record;
  }

  /** A module from source text rather than disk; a path already added is returned as is. */
  addVirtualModule(filePath: string, sourceText: string): ModuleRecord | null {
    const cached = this.modules.get(filePath);
    if (cached !== undefined) return cached;
    const lang = getSourceLanguage(filePath);
    if (!lang) return null;
    const file = this.sourceFileCache.readVirtual(filePath, sourceText, lang);
    const record = file.errors.length === 0 ? createModuleRecord(file) : null;
    this.modules.set(filePath, record);
    return record;
  }

  resolveSpecifier(specifier: string, fromModule: ModuleRecord): ModuleResolution {
    return this.resolver.resolve(
      specifier,
      fromModule.filePath,
      fromModule.isCommonJs ? "commonjs" : "esm",
    );
  }

  resolveImportedModule(
    specifier: string,
    fromModule: ModuleRecord,
  ): ModuleRecord | ModuleResolution {
    return this.getResolvedModule(this.resolveSpecifier(specifier, fromModule), specifier);
  }

  private getResolvedModule(
    resolution: ModuleResolution,
    specifier: string,
  ): ModuleRecord | ModuleResolution {
    if (resolution.kind !== "internal" && resolution.kind !== "external") return resolution;
    if (resolution.filePath === null) return resolution;
    const assetModule = this.getAssetModule(resolution.filePath, specifier);
    if (assetModule) return assetModule;
    if (resolution.kind === "external" && !this.shouldAnalyzePackage(resolution.packageName)) {
      return resolution;
    }
    return this.getModule(resolution.filePath) ?? resolution;
  }

  private getAssetModule(filePath: string, specifier: string): ModuleRecord | null {
    if (!specifier.includes("?")) return null;
    const source = readAssetModuleSource(filePath, specifier);
    if (!source) return null;
    const cached = this.modules.get(source.moduleKey);
    if (cached) return cached;
    const record = createModuleRecord(
      this.sourceFileCache.readVirtual(source.moduleKey, source.sourceText, "js"),
    );
    this.modules.set(source.moduleKey, record);
    return record;
  }

  resolveImport(binding: ImportBinding, fromModule: ModuleRecord): ResolvedSymbol {
    return this.resolveImportedName(binding.specifier, binding.imported, fromModule, new Set());
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
    if (visited.has(module.filePath)) return { names: [], complete: true };
    visited.add(module.filePath);
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
    return (
      this.resolveExternalPackages ||
      this.externalPackageAllowList.has(packageName) ||
      this.externalScopeAllowList.has(packageName.split("/")[0]) ||
      this.externalPackagePrefixes.some((prefix) => packageName.startsWith(prefix))
    );
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
      return {
        kind: "external",
        packageName: resolution.packageName,
        imported,
        specifier,
        filePath: resolution.filePath,
      };
    }
    const target = this.getResolvedModule(resolution, specifier);
    if (isModuleRecord(target)) {
      if (imported.kind === "namespace") return { kind: "namespace", module: target };
      return this.resolveExportFrom(target, describeImportedName(imported), fromModule, visited);
    }
    switch (target.kind) {
      case "external":
      case "builtin":
        return externalSymbol(target, imported, specifier);
      case "internal":
        if (isCssModulePath(target.filePath)) {
          return { kind: "stylesheet", filePath: target.filePath, imported };
        }
        if (isAssetPath(target.filePath)) {
          return { kind: "asset", filePath: target.filePath, imported };
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
    return isClientModule(target) && !isClientModule(fromModule)
      ? toClientReferenceSymbol(symbol)
      : symbol;
  }

  private resolveExportWithVisited(
    module: ModuleRecord,
    exportedName: string,
    visited: Set<string>,
  ): ResolvedSymbol {
    const visitKey = `${module.filePath}\u0000${exportedName}`;
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
        const target = this.resolveImportedModule(entry.specifier, module);
        if (!isModuleRecord(target)) {
          if (target.kind === "external" || target.kind === "builtin") {
            externalSources.push(
              externalSymbol(target, { kind: "named", name: exportedName }, entry.specifier),
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
    return { kind: "unresolved", reason: `no export "${exportedName}" in ${module.filePath}` };
  }
}

export const isModuleRecord = (value: ModuleRecord | ModuleResolution): value is ModuleRecord =>
  "bindings" in value;

const toClientReferenceSymbol = (symbol: ResolvedSymbol): ResolvedSymbol =>
  symbol.kind === "binding" || symbol.kind === "expression"
    ? { ...symbol, isClientReference: true }
    : symbol;

const externalSymbol = (
  target: ExternalModuleResolution | BuiltinModuleResolution,
  imported: ImportedName,
  specifier: string,
): ResolvedSymbol => ({
  kind: "external",
  packageName: target.kind === "external" ? target.packageName : target.specifier,
  imported,
  specifier,
  filePath: target.kind === "external" ? target.filePath : null,
});

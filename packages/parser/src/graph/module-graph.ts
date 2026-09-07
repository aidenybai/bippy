import { getSourceLanguage, SourceFileCache } from "../parse/parse-source-file.js";
import type {
  ImportBinding,
  ImportedName,
  ModuleRecord,
  ModuleResolution,
  ResolvedSymbol,
} from "../types.js";
import { isModeledLibraryExport, isModeledLibraryPackage } from "../libraries/index.js";
import { isCompilerHelperPackage } from "./helper-packages.js";
import { createModuleRecord } from "./module-record.js";
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

  constructor(options: ModuleGraphOptions) {
    this.resolver = options.resolver;
    this.sourceFileCache = options.sourceFileCache ?? new SourceFileCache();
    this.resolveExternalPackages = options.resolveExternalPackages ?? false;
    const allowList = options.externalPackageAllowList ?? [];
    this.externalPackageAllowList = new Set(allowList.filter((name) => !name.endsWith("/*")));
    this.externalScopeAllowList = new Set(
      allowList.filter((name) => name.endsWith("/*")).map((name) => name.slice(0, -2)),
    );
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

  addVirtualModule(filePath: string, sourceText: string): ModuleRecord | null {
    const lang = getSourceLanguage(filePath);
    if (!lang) return null;
    const file = this.sourceFileCache.readVirtual(filePath, sourceText, lang);
    const record = createModuleRecord(file);
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
    return this.getResolvedModule(this.resolveSpecifier(specifier, fromModule));
  }

  private getResolvedModule(resolution: ModuleResolution): ModuleRecord | ModuleResolution {
    if (resolution.kind === "internal") {
      return this.getModule(resolution.filePath) ?? resolution;
    }
    if (
      resolution.kind === "external" &&
      resolution.filePath &&
      this.shouldAnalyzePackage(resolution.packageName)
    ) {
      return this.getModule(resolution.filePath) ?? resolution;
    }
    return resolution;
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
      this.externalScopeAllowList.has(packageName.split("/")[0])
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
      imported.kind === "named" &&
      isModeledLibraryExport(resolution.packageName, imported.name)
    ) {
      return { kind: "external", packageName: resolution.packageName, imported, specifier };
    }
    const target = this.getResolvedModule(resolution);
    if (isModuleRecord(target)) {
      if (imported.kind === "namespace") return { kind: "namespace", module: target };
      return this.resolveExportWithVisited(target, describeImportedName(imported), visited);
    }
    switch (target.kind) {
      case "external":
        return { kind: "external", packageName: target.packageName, imported, specifier };
      case "builtin":
        return { kind: "external", packageName: target.specifier, imported, specifier };
      case "internal":
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
    return { kind: "binding", module, binding };
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
            return { kind: "expression", module, expression: entry.expression };
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
      for (const entry of module.exports) {
        if (entry.kind !== "re-export-all") continue;
        const target = this.resolveImportedModule(entry.specifier, module);
        if (!isModuleRecord(target)) continue;
        const resolved = this.resolveExportWithVisited(target, exportedName, visited);
        if (resolved.kind !== "unresolved") return resolved;
      }
    }
    return { kind: "unresolved", reason: `no export "${exportedName}" in ${module.filePath}` };
  }
}

export const isModuleRecord = (value: ModuleRecord | ModuleResolution): value is ModuleRecord =>
  "bindings" in value;

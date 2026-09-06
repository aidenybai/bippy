import { getSourceLanguage, SourceFileCache } from "../parse/parse-source-file.js";
import type {
  ImportBinding,
  ImportedName,
  ModuleRecord,
  ModuleResolution,
  ResolvedSymbol,
} from "../types.js";
import { createModuleRecord } from "./module-record.js";
import { ModuleResolver } from "./module-resolver.js";

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

  constructor(options: ModuleGraphOptions) {
    this.resolver = options.resolver;
    this.sourceFileCache = options.sourceFileCache ?? new SourceFileCache();
    this.resolveExternalPackages = options.resolveExternalPackages ?? false;
    this.externalPackageAllowList = new Set(options.externalPackageAllowList ?? []);
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
    return this.resolver.resolve(specifier, fromModule.filePath);
  }

  resolveImportedModule(
    specifier: string,
    fromModule: ModuleRecord,
  ): ModuleRecord | ModuleResolution {
    const resolution = this.resolveSpecifier(specifier, fromModule);
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

  listExportNames(module: ModuleRecord, visited = new Set<string>()): string[] {
    if (visited.has(module.filePath)) return [];
    visited.add(module.filePath);
    const names = new Set<string>();
    for (const entry of module.exports) {
      if (entry.kind === "re-export-all") {
        const target = this.resolveImportedModule(entry.specifier, module);
        if (isModuleRecord(target)) {
          for (const name of this.listExportNames(target, visited)) {
            if (name !== "default") names.add(name);
          }
        }
        continue;
      }
      names.add(entry.exportedName);
    }
    return [...names];
  }

  private shouldAnalyzePackage(packageName: string): boolean {
    return this.resolveExternalPackages || this.externalPackageAllowList.has(packageName);
  }

  private resolveImportedName(
    specifier: string,
    imported: ImportedName,
    fromModule: ModuleRecord,
    visited: Set<string>,
  ): ResolvedSymbol {
    const target = this.resolveImportedModule(specifier, fromModule);
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

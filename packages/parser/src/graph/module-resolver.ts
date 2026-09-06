import { isBuiltin } from "node:module";
import { ResolverFactory } from "oxc-resolver";
import type { ModuleResolution } from "../types.js";

export interface ModuleResolverOptions {
  tsconfigPath?: string;
  conditionNames?: string[];
}

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"];

const EXTENSION_ALIAS: Record<string, string[]> = {
  ".js": [".js", ".ts", ".tsx", ".jsx"],
  ".jsx": [".jsx", ".tsx"],
  ".mjs": [".mjs", ".mts"],
  ".cjs": [".cjs", ".cts"],
};

const DEFAULT_CONDITION_NAMES = ["browser", "import", "module", "default", "require"];

const NODE_MODULES_SEGMENT = "/node_modules/";

export const getPackageNameFromSpecifier = (specifier: string): string | null => {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return null;
  }
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null;
  }
  return segments[0] || null;
};

export const getPackageNameFromFilePath = (filePath: string): string | null => {
  const posixPath = filePath.replaceAll("\\", "/");
  const index = posixPath.lastIndexOf(NODE_MODULES_SEGMENT);
  if (index === -1) return null;
  const remainder = posixPath.slice(index + NODE_MODULES_SEGMENT.length);
  return getPackageNameFromSpecifier(remainder);
};

export const isInsideNodeModules = (filePath: string): boolean =>
  filePath.replaceAll("\\", "/").includes(NODE_MODULES_SEGMENT);

export class ModuleResolver {
  private readonly primary: ResolverFactory;
  private readonly fallback: ResolverFactory;
  private readonly cache = new Map<string, ModuleResolution>();

  constructor(options: ModuleResolverOptions = {}) {
    const conditionNames = options.conditionNames ?? DEFAULT_CONDITION_NAMES;
    const baseOptions = {
      extensions: SOURCE_EXTENSIONS,
      extensionAlias: EXTENSION_ALIAS,
      conditionNames,
      mainFields: ["browser", "module", "main"],
      nodePath: false,
    };
    this.primary = new ResolverFactory({
      ...baseOptions,
      tsconfig: options.tsconfigPath
        ? { configFile: options.tsconfigPath, references: "auto" }
        : "auto",
    });
    this.fallback = new ResolverFactory(baseOptions);
  }

  resolve(specifier: string, fromFile: string): ModuleResolution {
    const cacheKey = `${fromFile}\u0000${specifier}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const resolution = this.resolveUncached(specifier, fromFile);
    this.cache.set(cacheKey, resolution);
    return resolution;
  }

  private resolveUncached(specifier: string, fromFile: string): ModuleResolution {
    const bareSpecifier = specifier.replace(/^node:/, "");
    if (specifier.startsWith("node:") || isBuiltin(bareSpecifier)) {
      return { kind: "builtin", specifier };
    }
    const cleanSpecifier = specifier.split("?")[0];
    let result = this.primary.resolveFileSync(fromFile, cleanSpecifier);
    if (!result.path) {
      const fallbackResult = this.fallback.resolveFileSync(fromFile, cleanSpecifier);
      if (fallbackResult.path) result = fallbackResult;
    }
    if (result.path) {
      const packageName = getPackageNameFromFilePath(result.path);
      if (packageName) {
        return { kind: "external", packageName, filePath: result.path };
      }
      return { kind: "internal", filePath: result.path };
    }
    const packageName = getPackageNameFromSpecifier(cleanSpecifier);
    if (packageName) {
      return { kind: "external", packageName, filePath: null };
    }
    return { kind: "unresolved", specifier, error: result.error ?? "not found" };
  }
}

import { isBuiltin } from "node:module";
import path from "node:path";
import { ResolverFactory } from "oxc-resolver";
import type { ModuleResolution } from "../types.js";

export interface ModuleResolverOptions {
  tsconfigPath?: string;
  /** Bundler `resolve.alias`: a specifier (or its subpaths) resolved from another absolute path. */
  aliases?: Record<string, string>;
  conditionNames?: string[];
  requireConditionNames?: string[];
  /**
   * Package specifiers that resolve outside this directory are external even
   * when the resolved file is not under `node_modules` (workspace symlinks
   * pointing at sibling packages' sources or build output).
   */
  rootDirectory?: string;
}

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"];

const EXTENSION_ALIAS: Record<string, string[]> = {
  ".js": [".js", ".ts", ".tsx", ".jsx"],
  ".jsx": [".jsx", ".tsx"],
  ".mjs": [".mjs", ".mts"],
  ".cjs": [".cjs", ".cts"],
};

const DEFAULT_CONDITION_NAMES = ["browser", "import", "module", "default"];
const DEFAULT_REQUIRE_CONDITION_NAMES = ["browser", "require", "module", "default"];

export type ImporterKind = "esm" | "commonjs";

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

interface ResolverPair {
  primary: ResolverFactory;
  fallback: ResolverFactory;
}

export class ModuleResolver {
  private readonly resolvers: Record<ImporterKind, ResolverPair>;
  private readonly cache = new Map<string, ModuleResolution>();
  private readonly rootDirectory: string | null;

  constructor(options: ModuleResolverOptions = {}) {
    this.rootDirectory = options.rootDirectory ? path.resolve(options.rootDirectory) : null;
    const createPair = (conditionNames: string[]): ResolverPair => {
      const baseOptions = {
        extensions: SOURCE_EXTENSIONS,
        extensionAlias: EXTENSION_ALIAS,
        alias: Object.fromEntries(
          Object.entries(options.aliases ?? {}).map(([specifier, target]) => [specifier, [target]]),
        ),
        conditionNames,
        mainFields: ["browser", "module", "main"],
        nodePath: false,
      };
      return {
        primary: new ResolverFactory({
          ...baseOptions,
          tsconfig: options.tsconfigPath
            ? { configFile: options.tsconfigPath, references: "auto" }
            : "auto",
        }),
        fallback: new ResolverFactory(baseOptions),
      };
    };
    this.resolvers = {
      esm: createPair(options.conditionNames ?? DEFAULT_CONDITION_NAMES),
      commonjs: createPair(options.requireConditionNames ?? DEFAULT_REQUIRE_CONDITION_NAMES),
    };
  }

  resolve(specifier: string, fromFile: string, importer: ImporterKind = "esm"): ModuleResolution {
    const cacheKey = `${importer}\u0000${fromFile}\u0000${specifier}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const resolution = this.resolveUncached(specifier, fromFile, this.resolvers[importer]);
    this.cache.set(cacheKey, resolution);
    return resolution;
  }

  private resolveUncached(
    specifier: string,
    fromFile: string,
    { primary, fallback }: ResolverPair,
  ): ModuleResolution {
    const bareSpecifier = specifier.replace(/^node:/, "");
    if (specifier.startsWith("node:") || isBuiltin(bareSpecifier)) {
      return { kind: "builtin", specifier };
    }
    const cleanSpecifier = specifier.split("?")[0];
    let result = primary.resolveFileSync(fromFile, cleanSpecifier);
    if (!result.path) {
      const fallbackResult = fallback.resolveFileSync(fromFile, cleanSpecifier);
      if (fallbackResult.path) result = fallbackResult;
    }
    const specifierPackage = getPackageNameFromSpecifier(cleanSpecifier);
    if (result.path) {
      const packageName =
        getPackageNameFromFilePath(result.path) ??
        (specifierPackage !== null && this.isOutsideRoot(result.path) ? specifierPackage : null);
      if (packageName) {
        return { kind: "external", packageName, filePath: result.path };
      }
      return { kind: "internal", filePath: result.path };
    }
    if (specifierPackage) {
      return { kind: "external", packageName: specifierPackage, filePath: null };
    }
    return { kind: "unresolved", specifier, error: result.error ?? "not found" };
  }

  private isOutsideRoot(filePath: string): boolean {
    if (this.rootDirectory === null) return false;
    const relative = path.relative(this.rootDirectory, filePath);
    return relative.startsWith("..") || path.isAbsolute(relative);
  }
}

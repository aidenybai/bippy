import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { ResolverFactory, type ResolveResult } from "oxc-resolver";
import { z } from "zod";
import type { ModuleResolution } from "../types.js";

export interface ModuleResolverOptions {
  /** Path alias config; a sibling `jsconfig.json` stands in when this file does not exist. */
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

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"];

const EXTENSION_ALIAS: Record<string, string[]> = {
  ".js": [".js", ".ts", ".tsx", ".jsx"],
  ".jsx": [".jsx", ".tsx"],
  ".mjs": [".mjs", ".mts"],
  ".cjs": [".cjs", ".cts"],
};

const DEFAULT_CONDITION_NAMES = ["browser", "import", "module", "default"];
const DEFAULT_REQUIRE_CONDITION_NAMES = ["browser", "require", "module", "default"];

type ImporterKind = "esm" | "commonjs";

const NODE_MODULES_SEGMENT = "/node_modules/";
const JAVASCRIPT_CONFIG_FILE = "jsconfig.json";

/** The compiler config a project keeps: `tsconfigPath`, or the sibling `jsconfig.json` a JavaScript project has instead. */
export const getCompilerConfigFile = (tsconfigPath: string): string => {
  if (existsSync(tsconfigPath)) return tsconfigPath;
  const jsconfigPath = path.join(path.dirname(tsconfigPath), JAVASCRIPT_CONFIG_FILE);
  return existsSync(jsconfigPath) ? jsconfigPath : tsconfigPath;
};

const PACKAGE_ENTRY_FIELDS = z.object({
  exports: z.unknown().optional(),
  browser: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  module: z.string().optional(),
});

const ESM_SYNTAX_PATTERN =
  /([\s;]|^)(import[\w,{}\s*]*from|import\s*['"*{]|export\b\s*(?:[*{]|default|class|type|function|const|var|let|async function)|import\.meta\b)/m;

const getBrowserEntry = (browser: string | Record<string, unknown> | undefined): string | null => {
  if (typeof browser === "string") return browser;
  const rootEntry = browser?.["."];
  return typeof rootEntry === "string" ? rootEntry : null;
};

/**
 * Vite's `resolvePackageEntry`: a `browser` entry without ESM syntax (UMD/IIFE)
 * loses to the package's `module` entry; `exports` wins unless it picked an `.mjs`.
 */
const preferModuleOverNonEsmBrowserEntry = (
  { path: resolvedPath, packageJsonPath }: ResolveResult,
  resolver: ResolverFactory,
): string | null => {
  if (resolvedPath === undefined || packageJsonPath === undefined) return null;
  const parsed = PACKAGE_ENTRY_FIELDS.safeParse(JSON.parse(readFileSync(packageJsonPath, "utf8")));
  if (!parsed.success) return null;
  const { exports, browser, module } = parsed.data;
  const browserEntry = getBrowserEntry(browser);
  if (browserEntry === null || module === undefined || browserEntry === module) return null;
  if (exports !== undefined && !resolvedPath.endsWith(".mjs")) return null;
  const resolveFromPackage = (entry: string): string | null =>
    resolver.resolveFileSync(packageJsonPath, `./${entry}`).path ?? null;
  if (resolveFromPackage(browserEntry) !== resolvedPath) return null;
  if (ESM_SYNTAX_PATTERN.test(readFileSync(resolvedPath, "utf8"))) return null;
  return resolveFromPackage(module);
};

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

/** webpack's inline loader syntax (`loader!request`, `!!loader!request`): loaders transform the file the last segment resolves to. */
export const isInlineLoaderRequest = (specifier: string): boolean => specifier.includes("!");

const stripInlineLoaders = (specifier: string): string =>
  specifier.slice(specifier.lastIndexOf("!") + 1);

export const isInsideNodeModules = (filePath: string): boolean =>
  filePath.replaceAll("\\", "/").includes(NODE_MODULES_SEGMENT);

interface ResolverPair {
  primary: ResolverFactory;
  fallback: ResolverFactory;
}

export class ModuleResolver {
  private readonly resolvers: Record<ImporterKind, ResolverPair>;
  private readonly cache = new Map<string, ModuleResolution>();
  private readonly aliasNames: string[];
  readonly rootDirectory: string | null;
  readonly extensions: readonly string[] = SOURCE_EXTENSIONS;

  constructor(options: ModuleResolverOptions = {}) {
    this.rootDirectory = options.rootDirectory ? path.resolve(options.rootDirectory) : null;
    this.aliasNames = Object.keys(options.aliases ?? {});
    const createPair = (conditionNames: string[]): ResolverPair => {
      const baseOptions = {
        extensions: SOURCE_EXTENSIONS,
        extensionAlias: EXTENSION_ALIAS,
        alias: Object.fromEntries(
          Object.entries(options.aliases ?? {}).map(([specifier, target]) => [specifier, [target]]),
        ),
        conditionNames,
        mainFields: ["browser", "module", "main"],
        aliasFields: ["browser"],
        nodePath: false,
      };
      return {
        primary: new ResolverFactory({
          ...baseOptions,
          tsconfig: options.tsconfigPath
            ? { configFile: getCompilerConfigFile(options.tsconfigPath), references: "auto" }
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
    const resolution = this.resolveUncached(specifier, fromFile, importer);
    this.cache.set(cacheKey, resolution);
    return resolution;
  }

  private resolveUncached(
    specifier: string,
    fromFile: string,
    importer: ImporterKind,
  ): ModuleResolution {
    const { primary, fallback } = this.resolvers[importer];
    if (specifier.startsWith("node:")) return { kind: "builtin", specifier };
    const cleanSpecifier = stripInlineLoaders(specifier).split("?")[0];
    let result = primary.resolveFileSync(fromFile, cleanSpecifier);
    if (isBuiltin(specifier)) {
      const installed = result.path ?? fallback.resolveFileSync(fromFile, cleanSpecifier).path;
      return installed !== undefined && getPackageNameFromFilePath(installed) === specifier
        ? { kind: "external", packageName: specifier, filePath: installed, specifier }
        : { kind: "builtin", specifier };
    }
    const fallbackResult = fallback.resolveFileSync(fromFile, cleanSpecifier);
    const isPathMapped = result.path !== undefined && result.path !== fallbackResult.path;
    if (!result.path && fallbackResult.path) result = fallbackResult;
    const specifierPackage = getPackageNameFromSpecifier(cleanSpecifier);
    if (result.path) {
      const isPackageRootImport = importer === "esm" && specifierPackage === cleanSpecifier;
      const filePath =
        (isPackageRootImport ? preferModuleOverNonEsmBrowserEntry(result, fallback) : null) ??
        result.path;
      const packageName =
        getPackageNameFromFilePath(filePath) ??
        (specifierPackage !== null &&
        !isPathMapped &&
        !this.isAliased(cleanSpecifier) &&
        this.isOutsideRoot(filePath)
          ? specifierPackage
          : null);
      if (packageName) {
        return {
          kind: "external",
          packageName,
          filePath,
          specifier: this.canonicalizeExternalSpecifier(
            cleanSpecifier,
            filePath,
            fromFile,
            importer,
          ),
        };
      }
      return { kind: "internal", filePath };
    }
    if (specifierPackage) {
      return {
        kind: "external",
        packageName: specifierPackage,
        filePath: null,
        specifier: cleanSpecifier,
      };
    }
    return { kind: "unresolved", specifier, error: result.error ?? "not found" };
  }

  /**
   * `next/script.js` and `next/script` load the same file (`LOAD_AS_FILE` probes the
   * extension), so the extensionless form names the module wherever it is modeled.
   */
  private canonicalizeExternalSpecifier(
    specifier: string,
    filePath: string,
    fromFile: string,
    importer: ImporterKind,
  ): string {
    const extension = path.extname(specifier);
    if (!SCRIPT_EXTENSIONS.has(extension)) return specifier;
    const extensionless = specifier.slice(0, -extension.length);
    if (getPackageNameFromSpecifier(extensionless) === extensionless) return specifier;
    const resolution = this.resolve(extensionless, fromFile, importer);
    return resolution.kind === "external" && resolution.filePath === filePath
      ? extensionless
      : specifier;
  }

  /** A bundler-aliased specifier is a path of the app itself however package-like it reads (tsconfig `paths` likewise). */
  private isAliased(specifier: string): boolean {
    return this.aliasNames.some(
      (alias) => specifier === alias || specifier.startsWith(`${alias}/`),
    );
  }

  private isOutsideRoot(filePath: string): boolean {
    if (this.rootDirectory === null) return false;
    const relative = path.relative(this.rootDirectory, filePath);
    return relative.startsWith("..") || path.isAbsolute(relative);
  }
}

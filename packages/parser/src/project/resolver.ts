import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { type NapiResolveOptions, ResolverFactory } from "oxc-resolver";

export interface ResolvedModule {
  path: string;
  /** Resolved into `node_modules` (or a Node builtin). */
  isExternal: boolean;
  packageName: string | null;
}

export interface ModuleResolver {
  resolve: (fromFile: string, specifier: string) => ResolvedModule | null;
}

export interface ModuleResolverOptions {
  rootDirectory: string;
  /** Extra aliases, e.g. from a bundler config: `{ "@": ["./src"] }`. */
  alias?: Record<string, string[]>;
}

const RESOLVER_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"];

const EXTENSION_ALIAS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".js", ".jsx"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"];

const BASE_OPTIONS: NapiResolveOptions = {
  extensions: RESOLVER_EXTENSIONS,
  extensionAlias: EXTENSION_ALIAS,
  conditionNames: ["browser", "import", "module", "development", "default"],
  mainFields: ["module", "browser", "main"],
  builtinModules: true,
};

const FALLBACK_OPTIONS: NapiResolveOptions = {
  ...BASE_OPTIONS,
  conditionNames: ["require", "node", "default"],
};

export const getPackageNameFromSpecifier = (specifier: string): string | null => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  const segments = specifier.split("/");
  if (specifier.startsWith("@"))
    return segments.length >= 2 ? segments.slice(0, 2).join("/") : null;
  return segments[0] || null;
};

const isInsideNodeModules = (filePath: string): boolean =>
  filePath.split(sep).includes("node_modules");

export const findNearestFile = (
  startDirectory: string,
  fileNames: readonly string[],
  stopDirectory: string,
): string | null => {
  let currentDirectory = resolve(startDirectory);
  const stopAt = resolve(stopDirectory);
  while (true) {
    for (const fileName of fileNames) {
      const candidate = join(currentDirectory, fileName);
      if (existsSync(candidate)) return candidate;
    }
    if (currentDirectory === stopAt) return null;
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory || !currentDirectory.startsWith(stopAt)) return null;
    currentDirectory = parentDirectory;
  }
};

/**
 * Wraps oxc-resolver with the conventions React projects rely on: tsconfig
 * `paths` (per nearest tsconfig, with project references), `.js` → `.ts`
 * extension aliases, and a CommonJS fallback for packages without ESM
 * conditions. Files that resolve into `node_modules` are flagged external.
 */
export const createModuleResolver = (options: ModuleResolverOptions): ModuleResolver => {
  const rootDirectory = resolve(options.rootDirectory);
  const resolversByTsconfig = new Map<string, ResolverFactory[]>();
  const tsconfigByDirectory = new Map<string, string | null>();
  const alias = options.alias;

  const getTsconfigForDirectory = (directory: string): string | null => {
    const cached = tsconfigByDirectory.get(directory);
    if (cached !== undefined) return cached;
    const tsconfigPath = isInsideNodeModules(directory)
      ? null
      : findNearestFile(directory, TSCONFIG_FILENAMES, rootDirectory);
    tsconfigByDirectory.set(directory, tsconfigPath);
    return tsconfigPath;
  };

  const createResolvers = (tsconfigPath: string | null): ResolverFactory[] => {
    const tsconfig = tsconfigPath
      ? { configFile: tsconfigPath, references: "auto" as const }
      : undefined;
    const attempts: NapiResolveOptions[] = [
      { ...BASE_OPTIONS, alias, tsconfig },
      { ...FALLBACK_OPTIONS, alias, tsconfig },
    ];
    const resolvers: ResolverFactory[] = [];
    for (const attempt of attempts) {
      try {
        resolvers.push(new ResolverFactory(attempt));
      } catch {
        if (attempt.tsconfig)
          resolvers.push(new ResolverFactory({ ...attempt, tsconfig: undefined }));
      }
    }
    return resolvers;
  };

  const getResolvers = (fromDirectory: string): ResolverFactory[] => {
    const tsconfigPath = getTsconfigForDirectory(fromDirectory);
    const cacheKey = tsconfigPath ?? "";
    let resolvers = resolversByTsconfig.get(cacheKey);
    if (!resolvers) {
      resolvers = createResolvers(tsconfigPath);
      resolversByTsconfig.set(cacheKey, resolvers);
    }
    return resolvers;
  };

  return {
    resolve: (fromFile, specifier) => {
      const fromDirectory = dirname(fromFile);
      for (const resolver of getResolvers(fromDirectory)) {
        let result: ReturnType<ResolverFactory["sync"]>;
        try {
          result = resolver.sync(fromDirectory, specifier);
        } catch {
          continue;
        }
        if (result.builtin) {
          return { path: result.builtin.resolved, isExternal: true, packageName: specifier };
        }
        if (!result.path) continue;
        const isExternal = isInsideNodeModules(result.path);
        return {
          path: result.path,
          isExternal,
          packageName: isExternal ? getPackageNameFromSpecifier(specifier) : null,
        };
      }
      return null;
    },
  };
};

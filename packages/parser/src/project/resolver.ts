import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { type NapiResolveOptions, ResolverFactory } from "oxc-resolver";
import { readTsconfigPaths } from "./tsconfig.js";

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
  /**
   * Absolute directories searched for bare specifiers ahead of `node_modules`,
   * e.g. a directory of workspace package links standing in for an install.
   */
  moduleDirectories?: string[];
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

const TSCONFIG_LOAD_ERROR = /^(Tsconfig|Failed to load tsconfig)/;

export const getPackageNameFromSpecifier = (specifier: string): string | null => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  const segments = specifier.split("/");
  if (specifier.startsWith("@"))
    return segments.length >= 2 ? segments.slice(0, 2).join("/") : null;
  return segments[0] || null;
};

const isInsideNodeModules = (filePath: string): boolean =>
  filePath.split(sep).includes("node_modules");

const isInsideDirectory = (filePath: string, directory: string): boolean =>
  filePath === directory || filePath.startsWith(directory + sep);

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
 * Oxc loads a tsconfig lazily and reports a config it cannot load (usually an
 * `extends` into an uninstalled package) on every resolution instead of at
 * construction, so one probe from the tsconfig's directory tells.
 */
const hasUnloadableTsconfig = (resolver: ResolverFactory, tsconfigPath: string): boolean => {
  try {
    const probe = resolver.sync(dirname(tsconfigPath), ".");
    return probe.error !== undefined && TSCONFIG_LOAD_ERROR.test(probe.error);
  } catch {
    return true;
  }
};

/**
 * Wraps oxc-resolver with the conventions React projects rely on: tsconfig
 * `paths` (per nearest tsconfig, with project references), `.js` → `.ts`
 * extension aliases, and a CommonJS fallback for packages without ESM
 * conditions. Files that resolve into `node_modules` are flagged external.
 * A project's dependencies live under its root: a resolution that walks up
 * into an ancestor's `node_modules` would analyze some other project's copy,
 * so it counts as unresolved.
 */
export const createModuleResolver = (options: ModuleResolverOptions): ModuleResolver => {
  const rootDirectory = resolve(options.rootDirectory);
  const realRootDirectory = existsSync(rootDirectory) ? realpathSync(rootDirectory) : rootDirectory;
  const resolversByTsconfig = new Map<string, ResolverFactory[]>();
  const tsconfigByDirectory = new Map<string, string | null>();
  const modules = [...(options.moduleDirectories ?? []), "node_modules"];

  const getTsconfigForDirectory = (directory: string): string | null => {
    const cached = tsconfigByDirectory.get(directory);
    if (cached !== undefined) return cached;
    const tsconfigPath = isInsideNodeModules(directory)
      ? null
      : findNearestFile(directory, TSCONFIG_FILENAMES, rootDirectory);
    tsconfigByDirectory.set(directory, tsconfigPath);
    return tsconfigPath;
  };

  const createResolverPair = (overrides: NapiResolveOptions): ResolverFactory[] =>
    [BASE_OPTIONS, FALLBACK_OPTIONS].map(
      (base) => new ResolverFactory({ ...base, alias: options.alias, modules, ...overrides }),
    );

  /**
   * When oxc cannot load the tsconfig, its own `paths` and `baseUrl` are
   * replayed as aliases and module directories, which loses only what the
   * unreachable parent config would have added.
   */
  const createResolvers = (tsconfigPath: string | null): ResolverFactory[] => {
    if (tsconfigPath === null) return createResolverPair({});
    const resolvers = createResolverPair({
      tsconfig: { configFile: tsconfigPath, references: "auto" },
    });
    if (!hasUnloadableTsconfig(resolvers[0], tsconfigPath)) return resolvers;
    const mapping = readTsconfigPaths(tsconfigPath);
    return createResolverPair({
      alias: { ...mapping.alias, ...options.alias },
      modules: mapping.baseUrl ? [mapping.baseUrl, ...modules] : modules,
    });
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
        if (!result.path || !isInsideDirectory(result.path, realRootDirectory)) continue;
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

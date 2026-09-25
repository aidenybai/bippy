import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  createModuleResolver,
  type ModuleResolution,
  type ModuleResolverOptions,
} from "./module-resolver.js";
import { ResolverConfigurationError } from "./errors.js";
import { getResolutionError } from "./resolution-error.js";
import { readResolverConfig } from "./utils/read-resolver-config.js";
import { resolveAliases } from "./utils/resolve-aliases.js";
import { loadNextConfig, type NextResolverConfig } from "./utils/load-next-config.js";

export { AnalyzerError, ResolverConfigurationError } from "./errors.js";
export type { ModuleResolution } from "./module-resolver.js";

export interface ProjectResolverOptions extends Omit<
  Partial<ModuleResolverOptions>,
  "aliasPrecedence"
> {
  rootDirectory: string;
  platform?: "browser" | "node";
  mode?: "development" | "production";
  configFile?: string | false;
  allowConfigExecution?: boolean;
  configTimeoutMs?: number;
}

export interface DiscoveryRequest {
  kind?: "import" | "require";
}

export interface ResolutionRequest extends DiscoveryRequest {
  platform?: "browser" | "node";
}

export interface ModuleDiscovery {
  classification: "browser-only" | "node-only" | "both" | "neither";
  browser: ModuleResolution;
  node: ModuleResolution;
}

export interface ProjectConfiguration {
  files: string[];
  diagnostics: string[];
  nextVersion?: string;
  configurationOutput?: string;
  aliasOrder: string[];
  aliasDirectory?: string;
  literalAliases?: boolean;
  recursiveAliases?: boolean;
  options: ModuleResolverOptions;
}

const configNames = ["vite", "rolldown", "webpack", "rspack", "next", "esbuild"].flatMap((name) =>
  ["js", "mjs", "ts", "cjs", "mts", "cts"].map((extension) => `${name}.config.${extension}`),
);

export const createResolver = (options: ProjectResolverOptions) => {
  const {
    rootDirectory,
    platform,
    mode = "production",
    configFile,
    allowConfigExecution = false,
    configTimeoutMs = 10000,
    ...overrides
  } = structuredClone(options);
  if (!isAbsolute(rootDirectory))
    throw new ResolverConfigurationError("The project root must be an absolute path");
  if (configFile && !isAbsolute(configFile))
    throw new ResolverConfigurationError("The configuration file must be an absolute path");
  if (!Number.isSafeInteger(configTimeoutMs) || configTimeoutMs <= 0)
    throw new ResolverConfigurationError("Configuration timeout must be a positive safe integer");
  const nextConfigurations = new Map<string, NextResolverConfig | ResolverConfigurationError>();
  const configurations = new Map<string, ProjectConfiguration>();
  const resolvers = new Map<string, ReturnType<typeof createModuleResolver>>();
  const getConfiguration = (
    fromFile: string,
    request: ResolutionRequest = {},
  ): ProjectConfiguration => {
    if (!isAbsolute(fromFile))
      throw new ResolverConfigurationError("The importing file must be an absolute path");
    const kind = request.kind ?? "import";
    const selectedPlatform = request.platform ?? platform;
    if (!selectedPlatform)
      throw new ResolverConfigurationError(
        "Select a platform for resolution, or use discover() to inspect both contexts",
      );
    const key = JSON.stringify([dirname(fromFile), kind, selectedPlatform]);
    const cached = configurations.get(key);
    if (cached) return structuredClone(cached);
    let tsconfigFile: string | undefined;
    let toolchainFile = configFile || undefined;
    let directory = dirname(fromFile);
    while (true) {
      const scopedPath = relative(rootDirectory, directory);
      if (scopedPath === ".." || scopedPath.startsWith(`..${sep}`) || isAbsolute(scopedPath)) break;
      const isDependency = scopedPath.split(sep).includes("node_modules");
      if (!isDependency && !tsconfigFile)
        tsconfigFile = ["tsconfig.json", "jsconfig.json"]
          .map((name) => join(directory, name))
          .find(existsSync);
      if (!isDependency && !toolchainFile && configFile !== false) {
        const candidates = configNames.map((name) => join(directory, name)).filter(existsSync);
        if (candidates.length > 1)
          throw new ResolverConfigurationError(
            `Multiple toolchain configurations found; select configFile explicitly: ${candidates.join(", ")}`,
          );
        toolchainFile = candidates[0];
      }
      if (directory === rootDirectory) break;
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    let nextConfiguration: NextResolverConfig | undefined;
    if (
      allowConfigExecution === true &&
      toolchainFile &&
      basename(toolchainFile).startsWith("next.config.")
    ) {
      const nextKey = JSON.stringify([toolchainFile, selectedPlatform, mode]);
      let cachedNext = nextConfigurations.get(nextKey);
      if (!cachedNext) {
        try {
          cachedNext = loadNextConfig(
            { configFile: toolchainFile, platform: selectedPlatform, mode },
            configTimeoutMs,
          );
        } catch (error) {
          cachedNext =
            error instanceof ResolverConfigurationError
              ? error
              : new ResolverConfigurationError("Cannot load Next configuration", error);
        }
        nextConfigurations.set(nextKey, cachedNext);
      }
      if (cachedNext instanceof ResolverConfigurationError) throw cachedNext;
      nextConfiguration = cachedNext;
    }
    const discovered =
      nextConfiguration?.[kind] ??
      (toolchainFile ? readResolverConfig(toolchainFile, rootDirectory) : {});
    const {
      diagnostics = [],
      aliasOrder = [],
      aliasDirectory,
      literalAliases,
      recursiveAliases,
      conditions,
      ...discoveredPolicy
    } = discovered;
    const configuration: ProjectConfiguration = {
      files: [toolchainFile, tsconfigFile].filter((file): file is string => file !== undefined),
      diagnostics,
      nextVersion: nextConfiguration?.version,
      configurationOutput: nextConfiguration?.output,
      aliasDirectory,
      literalAliases,
      recursiveAliases,
      aliasOrder: [...new Set([...Object.keys(overrides.alias ?? {}), ...aliasOrder])],
      options: {
        extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".cjs", ".mts", ".cts", ".json"],
        extensionAlias: {
          ".js": [".js", ".ts", ".tsx"],
          ".jsx": [".jsx", ".tsx"],
          ".mjs": [".mjs", ".mts"],
          ".cjs": [".cjs", ".cts"],
        },
        mainFields:
          selectedPlatform === "browser" ? ["browser", "module", "main"] : ["module", "main"],
        aliasFields: selectedPlatform === "browser" ? ["browser"] : [],
        conditionNames: [selectedPlatform, mode, kind],
        builtinModules: selectedPlatform === "node",
        tsconfig: tsconfigFile ? { configFile: tsconfigFile, references: "auto" } : undefined,
        ...discoveredPolicy,
        ...overrides,
        alias: { ...discoveredPolicy.alias, ...overrides.alias },
      },
    };
    if (conditions && !overrides.conditionNames)
      configuration.options.conditionNames = [...conditions, kind];
    configuration.options.conditionNames = configuration.options.conditionNames.map((condition) =>
      condition === "development|production" ? mode : condition,
    );
    configurations.set(key, configuration);
    return structuredClone(configuration);
  };
  const resolve = (
    specifier: string,
    fromFile: string,
    request: ResolutionRequest = {},
  ): ModuleResolution => {
    try {
      const configuration = getConfiguration(fromFile, request);
      const resolveFile = (request: string, isAliased: boolean): ModuleResolution => {
        const policy = {
          ...configuration.options,
          alias: undefined,
          tsconfig: isAliased ? undefined : configuration.options.tsconfig,
        };
        const key = JSON.stringify(policy);
        let resolver = resolvers.get(key);
        if (!resolver) {
          resolver = createModuleResolver(policy);
          resolvers.set(key, resolver);
        }
        const importer =
          isAliased && configuration.aliasDirectory
            ? join(configuration.aliasDirectory, "__bippy_resolver__.js")
            : fromFile;
        return resolver.resolve(request, importer);
      };
      const result = resolveAliases(specifier, configuration, resolveFile);
      if (result.kind === "file" && /\.d\.[cm]?ts(?:[?#]|$)/.test(result.id))
        return {
          kind: "unresolved",
          specifier,
          error: "Declaration files are not executable modules",
        };
      return result;
    } catch (error) {
      return { kind: "unresolved", specifier, error: getResolutionError(error) };
    }
  };
  return {
    getConfiguration,
    resolve,
    discover: (
      specifier: string,
      fromFile: string,
      request: DiscoveryRequest = {},
    ): ModuleDiscovery => {
      const browser = resolve(specifier, fromFile, { kind: request.kind, platform: "browser" });
      const node = resolve(specifier, fromFile, { kind: request.kind, platform: "node" });
      const hasBrowserResolution = browser.kind !== "unresolved";
      const hasNodeResolution = node.kind !== "unresolved";
      return {
        classification: hasBrowserResolution
          ? hasNodeResolution
            ? "both"
            : "browser-only"
          : hasNodeResolution
            ? "node-only"
            : "neither",
        browser,
        node,
      };
    },
    clearCache: () => {
      configurations.clear();
      nextConfigurations.clear();
      for (const resolver of resolvers.values()) resolver.clearCache();
      resolvers.clear();
    },
  };
};

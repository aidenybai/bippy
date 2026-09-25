import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createModuleResolver } from "../../src/module-resolver.js";

interface BundlerFixtureOptions {
  rootDirectory: string;
  tsconfigPath?: string | false;
  aliases?: Record<string, string | false>;
  conditions?: string[];
  nodeEnvironment?: string;
  preserveSymlinks?: boolean;
}

export const createBundlerFixtureResolver = (input: BundlerFixtureOptions) => {
  const options = structuredClone(input);
  const resolvers = new Map<string, ReturnType<typeof createModuleResolver>>();
  return {
    resolve: (
      specifier: string,
      fromFile: string,
      importer: "esm" | "commonjs" = "esm",
      environment: "client" | "server" = "client",
    ) => {
      const key = `${importer}:${environment}`;
      let resolver = resolvers.get(key);
      if (!resolver) {
        let configFile = options.tsconfigPath
          ? resolve(options.rootDirectory, options.tsconfigPath)
          : undefined;
        if (configFile && !existsSync(configFile) && basename(configFile) === "tsconfig.json") {
          const jsconfig = join(dirname(configFile), "jsconfig.json");
          if (existsSync(jsconfig)) configFile = jsconfig;
        }
        resolver = createModuleResolver({
          extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
          extensionAlias: {
            ".js": [".js", ".ts", ".tsx"],
            ".jsx": [".jsx", ".tsx"],
            ".mjs": [".mjs", ".mts"],
            ".cjs": [".cjs", ".cts"],
          },
          alias: Object.fromEntries(
            Object.entries(options.aliases ?? {}).map(([name, target]) => [
              name,
              [target === false ? null : target],
            ]),
          ),
          aliasPrecedence: "alias",
          conditionNames: [
            environment === "client" ? "browser" : "node",
            "module",
            options.nodeEnvironment === "production" ? "production" : "development",
            ...(options.conditions ?? []),
            importer === "esm" ? "import" : "require",
            "default",
          ],
          mainFields:
            environment === "client"
              ? ["browser", "module", "jsnext:main", "jsnext", "main"]
              : ["module", "main"],
          aliasFields: environment === "client" ? ["browser"] : [],
          tsconfig:
            options.tsconfigPath === false
              ? undefined
              : configFile
                ? { configFile, references: "auto" }
                : "auto",
          builtinModules: environment === "server",
          symlinks: !options.preserveSymlinks,
        });
        resolvers.set(key, resolver);
      }
      return resolver.resolve(specifier, fromFile);
    },
    clearCache: () => {
      for (const resolver of resolvers.values()) resolver.clearCache();
      resolvers.clear();
    },
  };
};

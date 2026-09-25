import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { NextConfigWorkerRequest, NextResolverConfig } from "./load-next-config.js";
import type { ResolverConfig } from "./read-resolver-config.js";
import { getResolutionError } from "../resolution-error.js";

// HACK: Oxc's ambient const enum cannot be imported with verbatimModuleSyntax.
const { EnforceExtension } = createRequire(import.meta.url)("oxc-resolver");

interface ResolverPlugin {
  constructor: { name: string };
  apply: unknown;
  paths?: unknown;
  resolvedBaseUrl?: unknown;
}

interface WebpackAlias {
  name: string;
  alias: string | string[] | false;
  onlyModule?: boolean;
}

const getAliases = (entries: WebpackAlias[]) => {
  const aliases = new Map<string, Array<string | null>>();
  for (const entry of entries) {
    if (typeof entry.name !== "string")
      throw new Error("Non-string resolver aliases cannot be represented by Oxc");
    const name = `${entry.name}${entry.onlyModule ? "$" : ""}`;
    if (aliases.has(name)) throw new Error(`Duplicate resolver alias: ${name}`);
    const targets =
      entry.alias === false ? [null] : Array.isArray(entry.alias) ? entry.alias : [entry.alias];
    if (targets.some((target) => target !== null && typeof target !== "string"))
      throw new Error(`Unsupported alias target: ${name}`);
    aliases.set(name, targets);
  }
  return aliases;
};

const main = async () => {
  const request: NextConfigWorkerRequest = JSON.parse(process.argv[2]);
  const directory = dirname(request.configFile);
  const require = createRequire(join(directory, "package.json"));
  const webpack = require("next/dist/compiled/webpack/webpack");
  webpack.init?.();
  const { JsConfigPathsPlugin } = require("next/dist/build/webpack/plugins/jsconfig-paths-plugin");
  const {
    OptionalPeerDependencyResolverPlugin,
  } = require("next/dist/build/webpack/plugins/optional-peer-dependency-resolve-plugin");
  const supportedPlugins = new Map<object, unknown>([
    [JsConfigPathsPlugin, JsConfigPathsPlugin.prototype.apply],
    [OptionalPeerDependencyResolverPlugin, OptionalPeerDependencyResolverPlugin.prototype.apply],
  ]);
  const loadConfig = require("next/dist/server/config").default;
  const dev = request.mode === "development";
  const config = await loadConfig(
    dev ? "phase-development-server" : "phase-production-build",
    directory,
  );
  if (config.configFile !== request.configFile)
    throw new Error(`Next selected ${config.configFile} instead of ${request.configFile}`);
  const configuration = require("next/dist/build/webpack-config");
  const info = await configuration.loadProjectInfo({ dir: directory, config, dev });
  const expectedPaths = JSON.stringify(info.jsConfig?.compilerOptions?.paths ?? {});
  const expectedBaseUrl = JSON.stringify(info.resolvedBaseUrl);
  const span = require("next/dist/trace").trace("bippy-resolver-config");
  try {
    const options = await configuration.default(directory, {
      buildId: "bippy-resolver",
      encryptionKey: "bippy-resolver",
      config,
      compilerType: request.platform === "browser" ? "client" : "server",
      dev,
      entrypoints: {},
      pagesDir: ["pages", "src/pages"].map((path) => join(directory, path)).find(existsSync),
      appDir: ["app", "src/app"].map((path) => join(directory, path)).find(existsSync),
      rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
      originalRewrites: undefined,
      originalRedirects: undefined,
      runWebpackSpan: span,
      ...info,
      previewProps: {
        previewModeId: "bippy-resolver",
        previewModeEncryptionKey: "bippy-resolver",
        previewModeSigningKey: "bippy-resolver",
      },
    });
    const compiler = webpack.webpack(options);
    try {
      const getPolicy = (dependencyType: "esm" | "commonjs"): ResolverConfig => {
        const policy = compiler.resolverFactory.get("normal", { dependencyType }).options;
        const plugins: ResolverPlugin[] = policy.plugins;
        const pluginNames = plugins.map((plugin) => plugin.constructor.name);
        const unknownPlugins = plugins.filter(
          (plugin: ResolverPlugin) =>
            !supportedPlugins.has(plugin.constructor) ||
            supportedPlugins.get(plugin.constructor) !== plugin.apply,
        );
        if (unknownPlugins.length)
          throw new Error(
            `Unsupported resolver plugins: ${unknownPlugins.map((plugin: object) => plugin.constructor.name).join(", ")}`,
          );
        for (const plugin of plugins) {
          if (
            plugin.constructor === JsConfigPathsPlugin &&
            (JSON.stringify(plugin.paths) !== expectedPaths ||
              JSON.stringify(plugin.resolvedBaseUrl) !== expectedBaseUrl)
          )
            throw new Error(
              "Modified JsConfigPathsPlugin settings cannot be represented by the original tsconfig",
            );
        }
        if (
          [...policy.descriptionFiles].some((name: string) => name !== "package.json") ||
          policy.restrictions.size
        )
          throw new Error(
            "Custom package descriptions or path restrictions cannot be represented by this policy loader",
          );
        const aliases = getAliases(policy.alias);
        return {
          diagnostics: [
            "Next webpack filesystem policy only; Turbopack, compiler hooks, module rules, externals, RSC and edge layers are not represented",
            "Configuration callbacks receive synthetic build metadata; build-identity-dependent behavior is not validated",
            ...(pluginNames.includes("OptionalPeerDependencyResolverPlugin")
              ? [
                  "Missing optional peers remain unresolved; Next may replace them with ignored modules",
                ]
              : []),
          ],
          alias: Object.fromEntries(aliases),
          aliasOrder: [...aliases.keys()],
          fallback: Object.fromEntries(getAliases(policy.fallback)),
          conditionNames: [...policy.conditionNames],
          extensions: [...policy.extensions],
          extensionAlias: Object.fromEntries(
            policy.extensionAlias.map((entry: { extension: string; alias: string[] }) => [
              entry.extension,
              entry.alias,
            ]),
          ),
          mainFields: policy.mainFields.map((field: { name: string[] }) => {
            if (field.name.length !== 1)
              throw new Error("Nested main fields cannot be represented by Oxc");
            return field.name[0];
          }),
          mainFiles: [...policy.mainFiles],
          aliasFields: [...policy.aliasFields],
          exportsFields: [...policy.exportsFields],
          importsFields: [...policy.importsFields],
          modules: policy.modules.flat(),
          symlinks: policy.symlinks,
          fullySpecified: policy.fullySpecified,
          preferRelative: policy.preferRelative,
          preferAbsolute: policy.preferAbsolute,
          roots: [...policy.roots],
          enforceExtension: policy.enforceExtension
            ? EnforceExtension.Enabled
            : EnforceExtension.Disabled,
          builtinModules: request.platform === "node",
          tsconfig: info.jsConfigPath
            ? { configFile: info.jsConfigPath, references: "auto" }
            : undefined,
        };
      };
      const result: NextResolverConfig = {
        version: require("next/package.json").version,
        configFile: request.configFile,
        import: getPolicy("esm"),
        require: getPolicy("commonjs"),
      };
      writeFileSync(request.outputFile, JSON.stringify(result), { flag: "wx" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        compiler.close((error: unknown) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    span.stop();
  }
};

main().then(
  () => {
    // HACK: Next may retain trace/configuration handles after its compiler closes.
    process.exit(0);
  },
  (error: unknown) => {
    console.error(getResolutionError(error));
    process.exit(1);
  },
);

import { existsSync } from "node:fs";
import path from "node:path";
import { EMPTY_OBSERVATIONS } from "../observations.js";
import { readPackageManifest } from "../package-manifest.js";
import type {
  ModuleBundler,
  ModuleTranspiler,
  ProcessEnvironment,
  ProjectContext,
  RuntimeObservations,
} from "../types.js";
import { findInstallRoot } from "./install-root.js";
import { readInstalledPackage } from "./installed-package.js";
import type { ModuleResolver } from "./module-resolver.js";
import { createServedAssets } from "./served-assets.js";
import { defaultViteConfig, loadViteConfig } from "./vite-config.js";

export const readDeclaredDependencies = (manifestPath: string): string[] => {
  if (!existsSync(manifestPath)) return [];
  const manifest = readPackageManifest(manifestPath);
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  });
};

/**
 * Build tooling (babel/swc plugins) is never imported and, being pulled in
 * transitively by the libraries it serves, is installed in projects that do not
 * use it, so what the project itself declares in the manifests from the root
 * upwards (its workspace root included) is the signal.
 */
interface ProjectContextOptions {
  rootDirectory: string;
  resolver: ModuleResolver;
  /** The bundler's served root (Vite `root`) when it differs from what its config declares. */
  servedDirectory?: string;
  /** Directory served as-is at the URL root (Vite `publicDir`) when it differs from what its config declares. */
  publicDirectory?: string;
  /** The dev server's environment, which its bundler config reads through `process.env`. */
  environment?: ProcessEnvironment;
  /** The command line the dev server is started with (its `--config`/`--mode` flags). */
  devCommand?: string;
  /** Directory the dev server is started in, where its config is looked up; `rootDirectory` when unset. */
  devDirectory?: string;
  observations?: RuntimeObservations;
  origin?: string | null;
  transpiler?: ModuleTranspiler;
  bundler?: ModuleBundler;
}

export const createProjectContext = (options: ProjectContextOptions): ProjectContext => {
  const {
    rootDirectory,
    resolver,
    observations = EMPTY_OBSERVATIONS,
    origin = null,
    transpiler = "name-preserving",
    bundler = "unknown",
  } = options;
  const declared = new Set<string>();
  const installRoot = findInstallRoot(rootDirectory);
  for (let directory = rootDirectory; ; directory = path.dirname(directory)) {
    for (const packageName of readDeclaredDependencies(path.join(directory, "package.json"))) {
      declared.add(packageName);
    }
    if (directory === installRoot || path.dirname(directory) === directory) break;
  }
  const hasDeclaredDependency = (packageName: string): boolean => declared.has(packageName);
  const readPackageVersion = (packageName: string): string | null =>
    readInstalledPackage(resolver, rootDirectory, packageName)?.version ?? null;
  const viteConfig =
    bundler === "vite"
      ? loadViteConfig({
          rootDirectory,
          devDirectory: options.devDirectory,
          resolver,
          hasDeclaredDependency,
          readPackageVersion,
          environment: options.environment,
          devCommand: options.devCommand,
        })
      : defaultViteConfig(rootDirectory);
  const servedDirectory = options.servedDirectory ?? viteConfig.root;
  const publicDirectory = options.publicDirectory ?? viteConfig.publicDir;
  const queries = new Map(observations.queries.map((query) => [query.queryHash, query]));
  const { mutations, stores } = observations;
  const assets = createServedAssets({
    rootDirectory,
    servedDirectory,
    publicDirectory,
    base: viteConfig.base,
    origin,
    viteVersion:
      bundler === "vite" || hasDeclaredDependency("vite") ? readPackageVersion("vite") : null,
    shouldInlineAsset: viteConfig.shouldInlineAsset,
  });
  return {
    rootDirectory,
    servedDirectory,
    baseUrl: viteConfig.base,
    mode: viteConfig.mode,
    viteConfigPath: viteConfig.configPath,
    hasDeclaredDependency,
    readPackageVersion,
    transpiler,
    bundler,
    getImportedAssetUrl: assets.getImportedUrl,
    readServedAsset: assets.read,
    findQuery: (queryHash) => queries.get(queryHash) ?? null,
    findMutations: (mutationHash) =>
      mutations?.filter((mutation) => mutation.mutationHash === mutationHash) ?? null,
    linguiCatalog: observations.lingui ?? null,
    routerState: observations.router ?? null,
    storeStates: stores ?? null,
  };
};

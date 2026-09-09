import { existsSync, readFileSync } from "node:fs";
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

/** Where Next, Vite and CRA dev servers serve static files from, at the URL root, unless configured otherwise. */
const PUBLIC_DIRECTORY = "public";

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
export interface ProjectContextOptions {
  rootDirectory: string;
  resolver: ModuleResolver;
  /** The bundler's served root (Vite `root`) when it is not `rootDirectory`. */
  servedDirectory?: string;
  /** Directory served as-is at the URL root (Vite `publicDir`); `public/` under the served root by default. */
  publicDirectory?: string;
  observations?: RuntimeObservations;
  origin?: string | null;
  transpiler?: ModuleTranspiler;
  bundler?: ModuleBundler;
  /** The environment the dev server runs with, when known. */
  environment?: ProcessEnvironment;
}

export const createProjectContext = (options: ProjectContextOptions): ProjectContext => {
  const {
    rootDirectory,
    resolver,
    observations = EMPTY_OBSERVATIONS,
    origin = null,
    transpiler = "name-preserving",
    bundler = "unknown",
    environment = null,
  } = options;
  const servedDirectory = options.servedDirectory ?? rootDirectory;
  const publicDirectory = options.publicDirectory ?? path.join(servedDirectory, PUBLIC_DIRECTORY);
  const declared = new Set<string>();
  const installRoot = findInstallRoot(rootDirectory);
  for (let directory = rootDirectory; ; directory = path.dirname(directory)) {
    for (const packageName of readDeclaredDependencies(path.join(directory, "package.json"))) {
      declared.add(packageName);
    }
    if (directory === installRoot || path.dirname(directory) === directory) break;
  }
  const queries = new Map(observations.queries.map((query) => [query.queryHash, query]));
  const { mutations, stores } = observations;
  const hasDeclaredDependency = (packageName: string): boolean => declared.has(packageName);
  const readPackageVersion = (packageName: string): string | null =>
    readInstalledPackage(resolver, rootDirectory, packageName)?.version ?? null;
  const assets = createServedAssets({
    rootDirectory,
    servedDirectory,
    publicDirectory,
    origin,
    bundler,
    environment,
    hasDeclaredDependency,
    readPackageVersion,
  });
  return {
    rootDirectory,
    servedDirectory,
    hasDeclaredDependency,
    readPackageVersion,
    transpiler,
    bundler,
    getImportedAssetUrl: assets.getImportedUrl,
    findServedFile: assets.findServedFile,
    readServedAsset: (url) => {
      const filePath = assets.findServedFile(url);
      return filePath === null ? null : readFileSync(filePath, "utf8");
    },
    findQuery: (queryHash) => queries.get(queryHash) ?? null,
    findMutations: (mutationHash) =>
      mutations?.filter((mutation) => mutation.mutationHash === mutationHash) ?? null,
    linguiCatalog: observations.lingui ?? null,
    routerState: observations.router ?? null,
    storeStates: stores ?? null,
  };
};

import { existsSync } from "node:fs";
import path from "node:path";
import type { ModuleResolver } from "./module-resolver.js";
import { EMPTY_OBSERVATIONS } from "../observations.js";
import { readPackageManifest } from "../package-manifest.js";
import type { ProjectContext, RuntimeObservations } from "../types.js";
import { createServedAssets } from "./served-assets.js";

/** Where Next, Vite and CRA dev servers serve static files from, at the URL root. */
const PUBLIC_DIRECTORY = "public";

const readDeclaredDependencies = (manifestPath: string): string[] => {
  if (!existsSync(manifestPath)) return [];
  const manifest = readPackageManifest(manifestPath);
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  });
};

/** The version of the package the project's own resolution reaches, as its manifest declares it. */
export const readPackageVersion = (
  resolver: ModuleResolver,
  rootDirectory: string,
  packageName: string,
): string | null => {
  const resolution = resolver.resolve(`${packageName}/package.json`, `${rootDirectory}/index.js`);
  if (resolution.kind !== "external" || !resolution.filePath) return null;
  return readPackageManifest(resolution.filePath).version ?? null;
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
}

export const createProjectContext = (options: ProjectContextOptions): ProjectContext => {
  const { rootDirectory, resolver, observations = EMPTY_OBSERVATIONS, origin = null } = options;
  const servedDirectory = options.servedDirectory ?? rootDirectory;
  const publicDirectory = options.publicDirectory ?? path.join(servedDirectory, PUBLIC_DIRECTORY);
  const declared = new Set<string>();
  for (let directory = rootDirectory; ; directory = path.dirname(directory)) {
    for (const packageName of readDeclaredDependencies(path.join(directory, "package.json"))) {
      declared.add(packageName);
    }
    if (path.dirname(directory) === directory) break;
  }
  const queries = new Map(observations.queries.map((query) => [query.queryHash, query]));
  const { mutations, stores } = observations;
  const hasDeclaredDependency = (packageName: string): boolean => declared.has(packageName);
  const assets = createServedAssets({
    rootDirectory,
    servedDirectory,
    publicDirectory,
    origin,
    hasDeclaredDependency,
  });
  return {
    rootDirectory,
    servedDirectory,
    hasDeclaredDependency,
    readPackageVersion: (packageName) => readPackageVersion(resolver, rootDirectory, packageName),
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

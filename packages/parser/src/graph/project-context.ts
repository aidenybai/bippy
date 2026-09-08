import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EMPTY_OBSERVATIONS } from "../observations.js";
import { readPackageManifest } from "../package-manifest.js";
import type { ModuleTranspiler, ProjectContext, RuntimeObservations } from "../types.js";
import { readInstalledPackage } from "./installed-package.js";
import type { ModuleResolver } from "./module-resolver.js";

/** Where Next, Vite and CRA dev servers serve static files from, at the URL root. */
const PUBLIC_DIRECTORY = "public";

const readServedAsset = (
  rootDirectory: string,
  origin: string | null,
  url: string,
): string | null => {
  const base = origin ?? "http://origin.invalid";
  if ((origin === null && !url.startsWith("/")) || !URL.canParse(url, base)) return null;
  const parsed = new URL(url, base);
  if (origin !== null && parsed.origin !== origin) return null;
  const publicDirectory = path.join(rootDirectory, PUBLIC_DIRECTORY);
  const assetPath = path.join(publicDirectory, decodeURIComponent(parsed.pathname));
  if (!assetPath.startsWith(publicDirectory + path.sep) || !existsSync(assetPath)) return null;
  return readFileSync(assetPath, "utf8");
};

const readDeclaredDependencies = (manifestPath: string): string[] => {
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
export const createProjectContext = (
  rootDirectory: string,
  resolver: ModuleResolver,
  observations: RuntimeObservations = EMPTY_OBSERVATIONS,
  origin: string | null = null,
  transpiler: ModuleTranspiler = "name-preserving",
): ProjectContext => {
  const declared = new Set<string>();
  for (let directory = rootDirectory; ; directory = path.dirname(directory)) {
    for (const packageName of readDeclaredDependencies(path.join(directory, "package.json"))) {
      declared.add(packageName);
    }
    if (path.dirname(directory) === directory) break;
  }
  const queries = new Map(observations.queries.map((query) => [query.queryHash, query]));
  const { mutations, stores } = observations;
  return {
    rootDirectory,
    hasDeclaredDependency: (packageName) => declared.has(packageName),
    readPackageVersion: (packageName) =>
      readInstalledPackage(resolver, rootDirectory, packageName)?.version ?? null,
    transpiler,
    readServedAsset: (url) => readServedAsset(rootDirectory, origin, url),
    findQuery: (queryHash) => queries.get(queryHash) ?? null,
    findMutations: (mutationHash) =>
      mutations?.filter((mutation) => mutation.mutationHash === mutationHash) ?? null,
    linguiCatalog: observations.lingui ?? null,
    routerState: observations.router ?? null,
    storeStates: stores ?? null,
  };
};

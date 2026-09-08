import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ModuleResolver } from "./module-resolver.js";
import { EMPTY_OBSERVATIONS } from "../observations.js";
import { readPackageManifest } from "../package-manifest.js";
import type { ProjectContext, RuntimeObservations } from "../types.js";

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
export const createProjectContext = (
  rootDirectory: string,
  resolver: ModuleResolver,
  observations: RuntimeObservations = EMPTY_OBSERVATIONS,
  origin: string | null = null,
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
    readPackageVersion: (packageName) => readPackageVersion(resolver, rootDirectory, packageName),
    readServedAsset: (url) => readServedAsset(rootDirectory, origin, url),
    findQuery: (queryHash) => queries.get(queryHash) ?? null,
    findMutations: (mutationHash) =>
      mutations?.filter((mutation) => mutation.mutationHash === mutationHash) ?? null,
    linguiCatalog: observations.lingui ?? null,
    routerState: observations.router ?? null,
    storeStates: stores ?? null,
  };
};

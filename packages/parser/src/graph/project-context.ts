import { readFileSync } from "node:fs";
import path from "node:path";
import { EMPTY_OBSERVATIONS } from "../observations.js";
import type { ProjectContext, RuntimeObservations } from "../types.js";
import type { ModuleResolver } from "./module-resolver.js";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

/** Where Next, Vite and CRA dev servers serve static files from, at the URL root, unless configured otherwise. */
const DEFAULT_PUBLIC_DIRECTORY = "public";

const readServedAsset = (
  publicDirectory: string,
  origin: string | null,
  url: string,
): string | null => {
  if (origin === null && !url.startsWith("/")) return null;
  try {
    const parsed = new URL(url, origin ?? "http://origin.invalid");
    if (origin !== null && parsed.origin !== origin) return null;
    const assetPath = path.join(publicDirectory, decodeURIComponent(parsed.pathname));
    if (!assetPath.startsWith(publicDirectory + path.sep)) return null;
    return readFileSync(assetPath, "utf8");
  } catch {
    return null;
  }
};

const readManifest = (manifestPath: string): object | null => {
  try {
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    return typeof manifest === "object" ? manifest : null;
  } catch {
    return null;
  }
};

export const readDeclaredDependencies = (manifestPath: string): Set<string> | null => {
  const manifest = readManifest(manifestPath);
  if (manifest === null) return null;
  const declared = new Set<string>();
  for (const [field, value] of Object.entries(manifest)) {
    if (!DEPENDENCY_FIELDS.includes(field) || typeof value !== "object" || value === null) continue;
    for (const packageName of Object.keys(value)) declared.add(packageName);
  }
  return declared;
};

/** The version of the package the project's own modules would import, following the resolver like the bundler does. */
const readInstalledVersion = (
  resolver: ModuleResolver,
  rootDirectory: string,
  packageName: string,
): string | null => {
  const resolution = resolver.resolve(`${packageName}/package.json`, `${rootDirectory}/index.js`);
  if (resolution.kind !== "external" || !resolution.filePath) return null;
  const manifest = readManifest(resolution.filePath);
  return manifest !== null && "version" in manifest && typeof manifest.version === "string"
    ? manifest.version
    : null;
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
  publicDirectory: string = DEFAULT_PUBLIC_DIRECTORY,
): ProjectContext => {
  const servedDirectory = path.join(rootDirectory, publicDirectory);
  const declared = new Set<string>();
  for (let directory = rootDirectory; ; directory = path.dirname(directory)) {
    const dependencies = readDeclaredDependencies(path.join(directory, "package.json"));
    for (const packageName of dependencies ?? []) declared.add(packageName);
    if (path.dirname(directory) === directory) break;
  }
  const queries = new Map(observations.queries.map((query) => [query.queryHash, query]));
  const { mutations, stores } = observations;
  const installedVersions = new Map<string, string | null>();
  return {
    rootDirectory,
    hasDeclaredDependency: (packageName) => declared.has(packageName),
    readInstalledVersion: (packageName) => {
      const cached = installedVersions.get(packageName);
      if (cached !== undefined) return cached;
      const version = readInstalledVersion(resolver, rootDirectory, packageName);
      installedVersions.set(packageName, version);
      return version;
    },
    readServedAsset: (url) => readServedAsset(servedDirectory, origin, url),
    findQuery: (queryHash) => queries.get(queryHash) ?? null,
    findMutations: (mutationHash) =>
      mutations?.filter((mutation) => mutation.mutationHash === mutationHash) ?? null,
    linguiCatalog: observations.lingui ?? null,
    routerState: observations.router ?? null,
    storeStates: stores ?? null,
  };
};

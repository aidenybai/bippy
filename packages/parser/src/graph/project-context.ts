import { readFileSync } from "node:fs";
import path from "node:path";
import { EMPTY_OBSERVATIONS } from "../observations.js";
import type { ProjectContext, RuntimeObservations } from "../types.js";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

/** Where Next, Vite and CRA dev servers serve static files from, at the URL root. */
const PUBLIC_DIRECTORY = "public";

const readServedAsset = (
  rootDirectory: string,
  origin: string | null,
  url: string,
): string | null => {
  if (origin === null && !url.startsWith("/")) return null;
  try {
    const parsed = new URL(url, origin ?? "http://origin.invalid");
    if (origin !== null && parsed.origin !== origin) return null;
    const publicDirectory = path.join(rootDirectory, PUBLIC_DIRECTORY);
    const assetPath = path.join(publicDirectory, decodeURIComponent(parsed.pathname));
    if (!assetPath.startsWith(publicDirectory + path.sep)) return null;
    return readFileSync(assetPath, "utf8");
  } catch {
    return null;
  }
};

const readDeclaredDependencies = (manifestPath: string): Set<string> | null => {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
  if (typeof manifest !== "object" || manifest === null) return null;
  const declared = new Set<string>();
  for (const [field, value] of Object.entries(manifest)) {
    if (!DEPENDENCY_FIELDS.includes(field) || typeof value !== "object" || value === null) continue;
    for (const packageName of Object.keys(value)) declared.add(packageName);
  }
  return declared;
};

/**
 * Build tooling (babel/swc plugins) is never imported and, being pulled in
 * transitively by the libraries it serves, is installed in projects that do not
 * use it, so what the project itself declares in the manifests from the root
 * upwards (its workspace root included) is the signal.
 */
export const createProjectContext = (
  rootDirectory: string,
  observations: RuntimeObservations = EMPTY_OBSERVATIONS,
  origin: string | null = null,
): ProjectContext => {
  const declared = new Set<string>();
  for (let directory = rootDirectory; ; directory = path.dirname(directory)) {
    const dependencies = readDeclaredDependencies(path.join(directory, "package.json"));
    for (const packageName of dependencies ?? []) declared.add(packageName);
    if (path.dirname(directory) === directory) break;
  }
  const queries = new Map(observations.queries.map((query) => [query.queryHash, query]));
  const { mutations, stores } = observations;
  return {
    rootDirectory,
    hasDeclaredDependency: (packageName) => declared.has(packageName),
    readServedAsset: (url) => readServedAsset(rootDirectory, origin, url),
    findQuery: (queryHash) => queries.get(queryHash) ?? null,
    findMutations: (mutationHash) =>
      mutations?.filter((mutation) => mutation.mutationHash === mutationHash) ?? null,
    linguiCatalog: observations.lingui ?? null,
    routerState: observations.router ?? null,
    storeStates: stores ?? null,
  };
};

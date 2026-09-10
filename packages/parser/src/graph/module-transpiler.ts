import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import type {
  AssetTransform,
  JsonValue,
  BabelTransform,
  ModuleBundler,
  ModuleTranspiler,
  ProcessEnvironment,
} from "../types.js";
import {
  findExpoCliDirectory,
  getExpoDefines,
  getExpoBabelTransform,
  getExpoResolverOptions,
  getExpoWebBundler,
  readExpoDocumentShell,
} from "./expo-bundler.js";
import { getExpoAssetTransform } from "./expo-asset-transform.js";
import {
  getExpoWebpackAssetTransform,
  readExpoWebpackDocumentShell,
} from "./expo-webpack-config.js";
import { readInstalledPackage } from "./installed-package.js";
import { readPackageManifest } from "../package-manifest.js";
import type { ModuleResolver, ModuleResolverOptions } from "./module-resolver.js";
import { findViteConfig } from "./vite-config.js";

/** Vite 8 transpiles with Oxc; in earlier majors these React plugins take over from `vite:esbuild`. */
const LAST_ESBUILD_VITE_MAJOR = 7;
const REACT_PLUGINS_REPLACING_ESBUILD = new Set([
  "@vitejs/plugin-react-swc",
  "@vitejs/plugin-react-oxc",
]);

const importsReplacingPlugin = (configPath: string): boolean => {
  const { program } = parseSync(configPath, readFileSync(configPath, "utf8"), {
    sourceType: "module",
  });
  return program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      REACT_PLUGINS_REPLACING_ESBUILD.has(statement.source.value),
  );
};

/** Rsbuild's config may live anywhere (`rsbuild dev --config`); the project declares the core package. */
const declaresRsbuild = (directory: string): boolean => {
  const manifestPath = path.join(directory, "package.json");
  if (!existsSync(manifestPath)) return false;
  const { dependencies, devDependencies } = readPackageManifest(manifestPath);
  return (
    dependencies?.["@rsbuild/core"] !== undefined ||
    devDependencies?.["@rsbuild/core"] !== undefined
  );
};

/** Which bundler serves the web page: a project may bundle native platforms with Expo's Metro while another bundler builds its web target. */
export const detectModuleBundler = (...directories: string[]): ModuleBundler => {
  if (directories.some((directory) => findViteConfig(directory) !== undefined)) return "vite";
  if (directories.some(declaresRsbuild)) return "rsbuild";
  return directories.some((directory) => findExpoCliDirectory(directory) !== null)
    ? "expo"
    : "unknown";
};

/** The Metro platform a bundler targets when the entry does not say: Expo's dev server serves the `web` bundle to browsers. */
export const getDefaultPlatform = (bundler: ModuleBundler): string | undefined =>
  bundler === "expo" ? "web" : undefined;

/** How the bundler's own resolver rewrites requests before Node resolution applies. */
export const getBundlerResolverOptions = (
  rootDirectory: string,
  bundler: ModuleBundler,
  platform: string | undefined,
): Pick<ModuleResolverOptions, "aliases" | "shimDirectories"> => {
  if (bundler !== "expo" || platform === undefined) return {};
  const expoCliDirectory = findExpoCliDirectory(rootDirectory);
  return expoCliDirectory === null ? {} : getExpoResolverOptions(expoCliDirectory, platform);
};

/** The HTML the bundler serves as the page: Vite's dev server answers `/` with the root `index.html`, Expo's web bundler with its template. */
export const readDocumentShell = (rootDirectory: string, bundler: ModuleBundler): string | null => {
  if (bundler === "expo") {
    const expoCliDirectory = findExpoCliDirectory(rootDirectory);
    if (expoCliDirectory === null) return null;
    return getExpoWebBundler(rootDirectory) === "webpack"
      ? readExpoWebpackDocumentShell(rootDirectory)
      : readExpoDocumentShell(rootDirectory, expoCliDirectory);
  }
  if (bundler !== "vite") return null;
  const indexPath = path.join(rootDirectory, "index.html");
  return existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
};

/** The names the bundler inlines into every client module beyond the app's own `define`s. */
export const getBundlerDefines = (
  rootDirectory: string,
  bundler: ModuleBundler,
  platform: string | undefined,
): Record<string, JsonValue> =>
  bundler === "expo" && platform !== undefined ? getExpoDefines(rootDirectory, platform) : {};

/** The module the bundler links in place of an asset file: Metro's asset transformer or webpack's asset modules; Vite's URL modules are resolved as assets instead. */
export const getBundlerAssetTransform = (
  rootDirectory: string,
  bundler: ModuleBundler,
  platform: string | undefined,
): AssetTransform | null => {
  if (bundler !== "expo" || platform === undefined) return null;
  const expoCliDirectory = findExpoCliDirectory(rootDirectory);
  if (expoCliDirectory === null) return null;
  if (platform === "web" && getExpoWebBundler(rootDirectory) === "webpack") {
    return getExpoWebpackAssetTransform(rootDirectory);
  }
  return getExpoAssetTransform(rootDirectory, expoCliDirectory, platform);
};

const REACT_BABEL_TRANSFORM: BabelTransform = {
  pragma: null,
  createElementRewrites: [],
  workletizes: false,
};

/** How the bundler's project-level config compiles element creation in the entry's bundle; React's own runtime when it has none. */
export const getBundlerBabelTransform = (
  rootDirectory: string,
  bundler: ModuleBundler,
  platform: string | undefined,
  entryPath: string,
  environment: ProcessEnvironment | undefined,
): BabelTransform => {
  if (bundler !== "expo" || platform === undefined) return REACT_BABEL_TRANSFORM;
  const expoCliDirectory = findExpoCliDirectory(rootDirectory);
  return expoCliDirectory === null
    ? REACT_BABEL_TRANSFORM
    : getExpoBabelTransform(rootDirectory, expoCliDirectory, platform, entryPath, environment);
};

export const detectModuleTranspiler = (
  resolver: ModuleResolver,
  rootDirectory: string,
): ModuleTranspiler => {
  const configPath = findViteConfig(rootDirectory);
  if (configPath === undefined) return "name-preserving";
  const vite = readInstalledPackage(resolver, rootDirectory, "vite");
  if (vite === null || Number(vite.version.split(".")[0]) > LAST_ESBUILD_VITE_MAJOR) {
    return "name-preserving";
  }
  return importsReplacingPlugin(configPath) ? "name-preserving" : "esbuild";
};

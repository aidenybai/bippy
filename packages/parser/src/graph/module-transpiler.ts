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
import type { ModuleResolver, ModuleResolverOptions } from "./module-resolver.js";
import { readDeclaredDependencies } from "./project-context.js";
import { REACT_SCRIPTS_PACKAGE, getReactScriptsClientEnvironment } from "./react-scripts.js";
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

const hasViteConfig = (directory: string): boolean => findViteConfig(directory) !== undefined;

const declaresPackage = (directory: string, packageName: string): boolean =>
  readDeclaredDependencies(path.join(directory, "package.json")).includes(packageName);

/**
 * Which bundler serves the web page, looked up in the directory the dev server
 * starts in and the root: a Vite config, then the `@rsbuild/core` (whose config
 * may live anywhere, `rsbuild dev --config`) or `react-scripts` package, then
 * Expo's CLI; a project may bundle native platforms with Expo's Metro while
 * another bundler builds its web target.
 */
export const detectModuleBundler = (
  rootDirectory: string,
  devDirectory: string | null = null,
): ModuleBundler => {
  const directories = [devDirectory ?? rootDirectory, rootDirectory];
  if (directories.some(hasViteConfig)) return "vite";
  if (directories.some((directory) => declaresPackage(directory, "@rsbuild/core")))
    return "rsbuild";
  if (declaresPackage(rootDirectory, REACT_SCRIPTS_PACKAGE)) return "react-scripts";
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

const readOptionalFile = (filePath: string): string | null =>
  existsSync(filePath) ? readFileSync(filePath, "utf8") : null;

/**
 * The HTML the bundler serves as the page: Vite's dev server answers `/` with
 * the served root's `index.html`; `react-scripts` serves `public/index.html`
 * after `InterpolateHtmlPlugin` replaced each `%NAME%` with its client environment;
 * Expo's web bundler serves its template.
 */
export const readDocumentShell = (
  rootDirectory: string,
  bundler: ModuleBundler,
  environment: ProcessEnvironment | null,
  servedDirectory: string = rootDirectory,
): string | null => {
  if (bundler === "vite") return readOptionalFile(path.join(servedDirectory, "index.html"));
  if (bundler === "expo") {
    const expoCliDirectory = findExpoCliDirectory(rootDirectory);
    if (expoCliDirectory === null) return null;
    return getExpoWebBundler(rootDirectory) === "webpack"
      ? readExpoWebpackDocumentShell(rootDirectory)
      : readExpoDocumentShell(rootDirectory, expoCliDirectory);
  }
  if (bundler !== "react-scripts") return null;
  const template = readOptionalFile(path.join(rootDirectory, "public", "index.html"));
  if (template === null) return null;
  return Object.entries(getReactScriptsClientEnvironment(rootDirectory, environment)).reduce(
    (html, [name, value]) => html.replaceAll(`%${name}%`, String(value)),
    template,
  );
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

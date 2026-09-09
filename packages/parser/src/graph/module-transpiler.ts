import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import type { JsonValue, ModuleBundler, ModuleTranspiler } from "../types.js";
import {
  findExpoCliDirectory,
  getExpoDefines,
  getExpoResolverOptions,
  readExpoDocumentShell,
} from "./expo-bundler.js";
import { readInstalledPackage } from "./installed-package.js";
import type { ModuleResolver, ModuleResolverOptions } from "./module-resolver.js";

const VITE_CONFIG_FILES = ["js", "mjs", "cjs", "ts", "mts", "cts"].map(
  (extension) => `vite.config.${extension}`,
);

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

const findViteConfig = (rootDirectory: string): string | undefined =>
  VITE_CONFIG_FILES.map((fileName) => path.join(rootDirectory, fileName)).find((candidate) =>
    existsSync(candidate),
  );

export const detectModuleBundler = (rootDirectory: string): ModuleBundler => {
  if (findViteConfig(rootDirectory) !== undefined) return "vite";
  return findExpoCliDirectory(rootDirectory) === null ? "unknown" : "expo";
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

/** The HTML the bundler serves as the page: Vite's dev server answers `/` with the root `index.html`, Expo's with its template. */
export const readDocumentShell = (rootDirectory: string, bundler: ModuleBundler): string | null => {
  if (bundler === "expo") {
    const expoCliDirectory = findExpoCliDirectory(rootDirectory);
    return expoCliDirectory === null ? null : readExpoDocumentShell(rootDirectory, expoCliDirectory);
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

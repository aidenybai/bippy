import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import type { ModuleBundler, ModuleTranspiler } from "../types.js";
import { readInstalledPackage } from "./installed-package.js";
import type { ModuleResolver } from "./module-resolver.js";
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

export const detectModuleBundler = (...directories: string[]): ModuleBundler =>
  directories.some((directory) => findViteConfig(directory) !== undefined) ? "vite" : "unknown";

/** The HTML the bundler serves as the page: Vite's dev server answers `/` with the served root's `index.html`. */
export const readDocumentShell = (
  servedDirectory: string | null,
  bundler: ModuleBundler,
): string | null => {
  if (bundler !== "vite" || servedDirectory === null) return null;
  const indexPath = path.join(servedDirectory, "index.html");
  return existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import type { ModuleBundler, ModuleTranspiler, ProcessEnvironment } from "../types.js";
import { readInstalledPackage } from "./installed-package.js";
import type { ModuleResolver } from "./module-resolver.js";
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

/** A Vite config in the directory the dev server starts in or the root; otherwise `react-scripts` when the root declares it. */
export const detectModuleBundler = (
  rootDirectory: string,
  devDirectory: string | null = null,
): ModuleBundler => {
  if ([devDirectory ?? rootDirectory, rootDirectory].some(hasViteConfig)) return "vite";
  const declared = readDeclaredDependencies(path.join(rootDirectory, "package.json"));
  return declared.includes(REACT_SCRIPTS_PACKAGE) ? "react-scripts" : "unknown";
};

const hasViteConfig = (directory: string): boolean => findViteConfig(directory) !== undefined;

const readOptionalFile = (filePath: string): string | null =>
  existsSync(filePath) ? readFileSync(filePath, "utf8") : null;

/**
 * The HTML the bundler serves as the page: Vite's dev server answers `/` with
 * the served root's `index.html`; `react-scripts` serves `public/index.html`
 * after `InterpolateHtmlPlugin` replaced each `%NAME%` with its client environment.
 */
export const readDocumentShell = (
  rootDirectory: string,
  bundler: ModuleBundler,
  environment: ProcessEnvironment | null,
  servedDirectory: string = rootDirectory,
): string | null => {
  if (bundler === "vite") return readOptionalFile(path.join(servedDirectory, "index.html"));
  if (bundler !== "react-scripts") return null;
  const template = readOptionalFile(path.join(rootDirectory, "public", "index.html"));
  if (template === null) return null;
  return Object.entries(getReactScriptsClientEnvironment(rootDirectory, environment)).reduce(
    (html, [name, value]) => html.replaceAll(`%${name}%`, String(value)),
    template,
  );
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

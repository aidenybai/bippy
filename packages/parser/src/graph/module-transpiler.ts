import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import type { ModuleBundler, ModuleTranspiler } from "../types.js";
import { readInstalledPackage } from "./installed-package.js";
import type { ModuleResolver } from "./module-resolver.js";

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

export const findViteConfig = (rootDirectory: string): string | undefined =>
  VITE_CONFIG_FILES.map((fileName) => path.join(rootDirectory, fileName)).find((candidate) =>
    existsSync(candidate),
  );

/** The HTML the bundler serves as the page: Vite's dev server answers `/` with the root `index.html`. */
export const readDocumentShell = (rootDirectory: string, bundler: ModuleBundler): string | null => {
  if (bundler !== "vite") return null;
  const indexPath = path.join(rootDirectory, "index.html");
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

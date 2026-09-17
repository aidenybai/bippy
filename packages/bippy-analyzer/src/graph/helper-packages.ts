import type { ProjectContext } from "../types.js";
import { getPackageNameFromFilePath } from "./module-resolver.js";

const BABEL_RUNTIME_PACKAGE = "@babel/runtime";

const BABEL_RUNTIME_PACKAGES = new Set([BABEL_RUNTIME_PACKAGE, "@babel/runtime-corejs3"]);

const HELPER_PACKAGES = new Set([...BABEL_RUNTIME_PACKAGES, "tslib", "@swc/helpers"]);

export const isBabelRuntimePackage = (packageName: string): boolean =>
  BABEL_RUNTIME_PACKAGES.has(packageName);

const REACT_SCRIPTS_PACKAGE = "react-scripts";
const REGENERATOR_RUNTIME_GLOBAL = "regeneratorRuntime";
const REGENERATOR_RUNTIME_SPECIFIER = `${BABEL_RUNTIME_PACKAGE}/regenerator`;

/**
 * Compiler runtime helper packages are modeled natively by the evaluator and
 * never analyzed from source: their implementations rely on reflection.
 */
export const isCompilerHelperPackage = (packageName: string): boolean =>
  HELPER_PACKAGES.has(packageName);

/**
 * `react-scripts` runs every module except `@babel/runtime` itself through
 * `@babel/plugin-transform-runtime` with `regenerator: true`, which rewrites a
 * free `regeneratorRuntime` into an import of `@babel/runtime/regenerator`.
 */
export const getTransformedRuntimeSpecifier = (
  project: ProjectContext,
  filePath: string,
  name: string,
): string | null => {
  if (name !== REGENERATOR_RUNTIME_GLOBAL || !project.hasDeclaredDependency(REACT_SCRIPTS_PACKAGE))
    return null;
  return getPackageNameFromFilePath(filePath) === BABEL_RUNTIME_PACKAGE
    ? null
    : REGENERATOR_RUNTIME_SPECIFIER;
};

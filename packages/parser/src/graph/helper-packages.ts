const HELPER_PACKAGES = new Set([
  "@babel/runtime",
  "@babel/runtime-corejs3",
  "tslib",
  "@swc/helpers",
]);

/**
 * Compiler runtime helper packages are modeled natively by the evaluator and
 * never analyzed from source: their implementations rely on reflection.
 */
export const isCompilerHelperPackage = (packageName: string): boolean =>
  HELPER_PACKAGES.has(packageName);

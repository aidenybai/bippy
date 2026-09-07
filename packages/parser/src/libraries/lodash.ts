import { nativeFunction } from "../frameworks/stubs.js";
import type { ExternalValueProvider, ModeledExports, StaticValue } from "../types.js";

// Lodash wrappers that return the wrapped function's own result on first call:
// a render sees the same value whether or not the call was cached. Every other
// helper is analyzed from lodash's own source when the package is allow-listed.

export const LODASH_PACKAGES = ["lodash", "lodash-es"];

const TRANSPARENT_WRAPPERS = ["memoize", "once"];

export const LODASH_MODELED_EXPORTS: ModeledExports = Object.fromEntries(
  LODASH_PACKAGES.flatMap((packageName): Array<[string, string[]]> => [
    [packageName, TRANSPARENT_WRAPPERS],
    ...TRANSPARENT_WRAPPERS.map((helperName): [string, string[]] => [
      `${packageName}/${helperName}`,
      ["default"],
    ]),
  ]),
);

const transparentWrapper = (name: string): StaticValue =>
  nativeFunction(name, ([wrapped]) => wrapped);

export const lodashValue: ExternalValueProvider = (specifier, importedName) => {
  const [packageName, ...modulePath] = specifier.split("/");
  if (!LODASH_PACKAGES.includes(packageName)) return null;
  const helperName =
    modulePath.length === 1 && importedName === "default" ? modulePath[0] : importedName;
  return TRANSPARENT_WRAPPERS.includes(helperName) ? transparentWrapper(helperName) : null;
};

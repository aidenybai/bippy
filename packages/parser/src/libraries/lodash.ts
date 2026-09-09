import { UNDEFINED_VALUE, compareDeeply, decidedBooleanValue } from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type { ExternalValueProvider, ModeledExports, StaticValue } from "../types.js";

// Lodash wrappers that return the wrapped function's own result on first call:
// a render sees the same value whether or not the call was cached. `isEqual` is
// decided over static values directly rather than through lodash's own
// Stack/MapCache machinery. Every other helper is analyzed from lodash's
// source when the package is allow-listed.

export const LODASH_PACKAGES = ["lodash", "lodash-es"];

const TRANSPARENT_WRAPPERS = ["memoize", "once"];

const MODELED_HELPERS = [...TRANSPARENT_WRAPPERS, "isEqual"];

export const LODASH_MODELED_EXPORTS: ModeledExports = Object.fromEntries(
  LODASH_PACKAGES.flatMap((packageName): Array<[string, string[]]> => [
    [packageName, MODELED_HELPERS],
    ...MODELED_HELPERS.flatMap((helperName): Array<[string, string[]]> => [
      [`${packageName}/${helperName}`, ["default"]],
      [`${packageName}/${helperName}.js`, ["default"]],
    ]),
  ]),
);

const transparentWrapper = (name: string): StaticValue =>
  nativeFunction(name, ([wrapped]) => wrapped);

const isEqual = nativeFunction("isEqual", ([left, right]) =>
  decidedBooleanValue(
    compareDeeply(left ?? UNDEFINED_VALUE, right ?? UNDEFINED_VALUE),
    "lodash isEqual of partially known values",
  ),
);

export const lodashValue: ExternalValueProvider = (specifier, importedName) => {
  const [packageName, ...modulePath] = specifier.split("/");
  if (!LODASH_PACKAGES.includes(packageName)) return null;
  const helperName =
    modulePath.length === 1 && importedName === "default"
      ? modulePath[0].replace(/\.js$/, "")
      : importedName;
  if (helperName === "isEqual") return isEqual;
  return TRANSPARENT_WRAPPERS.includes(helperName) ? transparentWrapper(helperName) : null;
};

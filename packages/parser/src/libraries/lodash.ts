import { nativeFunction } from "../frameworks/stubs.js";
import type { ExternalValueProvider, StaticValue } from "../types.js";

// Lodash wrappers that return the wrapped function's own result on first call:
// a render sees the same value whether or not the call was cached.

export const LODASH_PACKAGES = ["lodash", "lodash-es"];

const TRANSPARENT_WRAPPERS: ReadonlySet<string> = new Set(["memoize", "once"]);

const transparentWrapper = (name: string): StaticValue =>
  nativeFunction(name, ([wrapped]) => wrapped);

export const lodashValue: ExternalValueProvider = (specifier, importedName) => {
  const [packageName, ...modulePath] = specifier.split("/");
  if (!LODASH_PACKAGES.includes(packageName)) return null;
  const helperName =
    modulePath.length === 1 && importedName === "default" ? modulePath[0] : importedName;
  return TRANSPARENT_WRAPPERS.has(helperName) ? transparentWrapper(helperName) : null;
};

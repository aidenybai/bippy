import { hasNamedProperty } from "../evaluate/has-property.js";
import {
  compareDeeply,
  decidedBooleanValue,
  getObjectProperty,
  getTruthiness,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type { ExternalValueProvider, ModeledExports, StaticValue } from "../types.js";

// Lodash function wrappers: `memoize`/`once` return the wrapped function's own
// result on first call, `debounce`/`throttle` decide from their options whether
// the first call runs synchronously. `isEqual` is decided over static values
// directly rather than through lodash's own Stack/MapCache machinery. Every
// other helper runs from lodash's own source as a pure package or is analyzed
// when the package is allow-listed. The per-method packages lodash publishes
// (`lodash.throttle`) default-export the same helpers.

const BUNDLE_PACKAGES = ["lodash", "lodash-es"];

const TRANSPARENT_WRAPPERS = ["memoize", "once"];

const RATE_LIMITERS = ["debounce", "throttle"];

const MODELED_HELPERS = [...TRANSPARENT_WRAPPERS, ...RATE_LIMITERS, "isEqual"];

const STANDALONE_PACKAGE_HELPERS: Readonly<Record<string, string>> = Object.fromEntries(
  MODELED_HELPERS.map((helperName) => [`lodash.${helperName.toLowerCase()}`, helperName]),
);

export const LODASH_PACKAGES = [...BUNDLE_PACKAGES, ...Object.keys(STANDALONE_PACKAGE_HELPERS)];

export const LODASH_MODELED_EXPORTS: ModeledExports = Object.fromEntries([
  ...BUNDLE_PACKAGES.flatMap((packageName): Array<[string, string[]]> => [
    [packageName, MODELED_HELPERS],
    ...MODELED_HELPERS.flatMap((helperName): Array<[string, string[]]> => [
      [`${packageName}/${helperName}`, ["default"]],
      [`${packageName}/${helperName}.js`, ["default"]],
    ]),
  ]),
  ...Object.keys(STANDALONE_PACKAGE_HELPERS).map((packageName): [string, string[]] => [
    packageName,
    ["default"],
  ]),
]);

const transparentWrapper = (name: string): StaticValue =>
  nativeFunction(name, ([wrapped]) => wrapped);

const isEqual = nativeFunction("isEqual", ([left, right]) =>
  decidedBooleanValue(
    compareDeeply(left ?? UNDEFINED_VALUE, right ?? UNDEFINED_VALUE),
    "lodash isEqual of partially known values",
  ),
);

/**
 * `debounce` reads `!!options.leading` (false without options); `throttle`
 * defaults it to true unless `'leading' in options`. Null when the options'
 * shape is not decided by the source.
 */
const readLeadingOption = (
  helperName: string,
  options: StaticValue | undefined,
): boolean | null => {
  const isThrottle = helperName === "throttle";
  if (options === undefined || options.kind === "primitive") return isThrottle;
  if (options.kind !== "object") return null;
  if (isThrottle) {
    const isDeclared = hasNamedProperty("leading", options);
    if (isDeclared === null) return null;
    const hasLeading = getTruthiness(isDeclared);
    if (hasLeading === null) return null;
    if (!hasLeading) return true;
  }
  return getTruthiness(getObjectProperty(options, "leading"));
};

/**
 * `debounced` from lodash's source: the first call runs `func` synchronously
 * only on the leading edge, every other invocation waits on a timer, so the
 * wrapped function escapes to code that runs after the render.
 */
const rateLimiter = (helperName: string): StaticValue =>
  nativeFunction(helperName, ([wrapped, , options], tools) => {
    const isLeading = readLeadingOption(helperName, options);
    let hasTimer = false;
    return {
      kind: "native-function",
      name: `${helperName}d`,
      call: (args) => {
        const isFirstCall = !hasTimer;
        hasTimer = true;
        if (isFirstCall && isLeading === true) return tools.call(wrapped, args);
        tools.markEscaped(wrapped);
        if (isFirstCall && isLeading === false) return UNDEFINED_VALUE;
        return unknownValue(
          isFirstCall
            ? `leading edge of a ${helperName}d call with uncertain options`
            : `later call of a ${helperName}d function`,
        );
      },
      onEscape: () => tools.markEscaped(wrapped),
    };
  });

const getHelperName = (specifier: string, importedName: string): string | null => {
  const standaloneHelper = STANDALONE_PACKAGE_HELPERS[specifier];
  if (standaloneHelper !== undefined) return importedName === "default" ? standaloneHelper : null;
  const [packageName, ...modulePath] = specifier.split("/");
  if (!BUNDLE_PACKAGES.includes(packageName)) return null;
  return modulePath.length === 1 && importedName === "default"
    ? modulePath[0].replace(/\.js$/, "")
    : importedName;
};

export const lodashValue: ExternalValueProvider = (specifier, importedName) => {
  const helperName = getHelperName(specifier, importedName);
  if (helperName === null) return null;
  if (helperName === "isEqual") return isEqual;
  if (TRANSPARENT_WRAPPERS.includes(helperName)) return transparentWrapper(helperName);
  return RATE_LIMITERS.includes(helperName) ? rateLimiter(helperName) : null;
};

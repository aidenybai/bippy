import { getTypeofValue } from "../evaluate/builtin-calls.js";
import { isBaseClassPrototype, isClassPrototype } from "../evaluate/class-component.js";
import { hasNamedProperty } from "../evaluate/has-property.js";
import { isArrayValue } from "../evaluate/type-predicates.js";
import {
  compareDeeply,
  decidedBooleanValue,
  getObjectProperty,
  getTruthiness,
  isNullish,
  mapValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { HostRealm } from "../host/host-realm.js";
import type {
  ExternalValueProvider,
  ModeledExports,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import { merge, mergeWith } from "./lodash-merge.js";

// Lodash function wrappers: `memoize`/`once` return the wrapped function's own
// result on first call, `debounce`/`throttle` decide from their options whether
// the first call runs synchronously. `isEqual`, `merge`/`mergeWith` and the type
// predicates are decided over static values directly: lodash's own source runs
// natively only on arguments the analysis can lower, and a React element or a
// program function has a decided type without being lowerable. Every other
// helper runs from lodash's own source as a pure package or is analyzed when
// the package is allow-listed. Each modeled helper is also its own per-method
// package (`lodash.mergewith`).

export const LODASH_PACKAGES = ["lodash", "lodash-es"];

const TRANSPARENT_WRAPPERS = ["memoize", "once"];

const RATE_LIMITERS = ["debounce", "throttle"];

const MERGERS: Record<string, StaticValue> = { merge, mergeWith };

interface StaticTypePredicate {
  (value: StaticValue, realm: HostRealm): boolean | null;
}

const getTypeofName = (value: StaticValue, realm: HostRealm): string | null => {
  const typeofValue = getTypeofValue(value, realm);
  return typeofValue.kind === "primitive" && typeof typeofValue.value === "string"
    ? typeofValue.value
    : null;
};

/** `isObjectLike`: `value != null && typeof value == 'object'`. */
const isObjectLike: StaticTypePredicate = (value, realm) => {
  const nullish = isNullish(value);
  if (nullish !== false) return nullish === null ? null : false;
  const typeofName = getTypeofName(value, realm);
  return typeofName === null ? null : typeofName === "object";
};

/** `baseGetTag(value)` for an object-like value whose `Object.prototype.toString` tag the analysis knows. */
const getObjectTag = (value: StaticValue): string | null => {
  switch (value.kind) {
    case "native-object":
      return Object.prototype.toString.call(value.value);
    case "object":
    case "element":
    case "context":
    case "component-reference":
      return "[object Object]";
    case "list":
    case "repeat":
      return "[object Array]";
    case "regexp":
      return "[object RegExp]";
    case "namespace":
      return "[object Module]";
    default:
      return null;
  }
};

/** `typeof value == type`, or a boxed primitive (`new String()`) whose tag names the type. */
const primitiveTypePredicate =
  (type: "string" | "number" | "boolean"): StaticTypePredicate =>
  (value, realm) => {
    const typeofName = getTypeofName(value, realm);
    if (typeofName === null) return null;
    if (typeofName === type) return true;
    if (typeofName !== "object") return false;
    if (value.kind === "list" || value.kind === "repeat") return false;
    const tag = getObjectTag(value);
    return tag === null ? null : tag === `[object ${type[0].toUpperCase()}${type.slice(1)}]`;
  };

/**
 * `isPlainObject`: an object whose prototype is null or `Object.prototype`,
 * the latter recognized by its own `constructor` being `Object` itself.
 */
const isPlainObjectValue = (object: StaticObjectValue): boolean | null => {
  if (object.constructedBy) return false;
  if (object.hasNullPrototype) return true;
  if (object.prototype) return isPlainObjectPrototype(object.prototype);
  return isClassPrototype(object) ? isBaseClassPrototype(object) : true;
};

const isPlainObjectPrototype = (prototype: StaticObjectValue): boolean | null =>
  isClassPrototype(prototype) ? false : isPlainObjectValue(prototype);

const isNativePlainObject = (value: object): boolean => {
  const prototype: object | null = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  const constructor: unknown = Object.hasOwn(prototype, "constructor")
    ? Reflect.get(prototype, "constructor")
    : undefined;
  return (
    typeof constructor === "function" &&
    Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object)
  );
};

const isPlainObject: StaticTypePredicate = (value, realm) => {
  const objectLike = isObjectLike(value, realm);
  if (objectLike !== true) return objectLike;
  const tag = getObjectTag(value);
  if (tag === null) return null;
  if (tag !== "[object Object]") return false;
  switch (value.kind) {
    case "object":
      return isPlainObjectValue(value);
    case "native-object":
      return isNativePlainObject(value.value);
    case "element":
    case "context":
    case "component-reference":
      return true;
    default:
      return null;
  }
};

const decideNullValue = (value: StaticValue, expected: null | undefined): boolean | null =>
  value.kind === "primitive" ? value.value === expected : isNullish(value) === false ? false : null;

const TYPE_PREDICATES: Record<string, StaticTypePredicate> = {
  isNil: (value) => isNullish(value),
  isNull: (value) => decideNullValue(value, null),
  isUndefined: (value) => decideNullValue(value, undefined),
  isObjectLike,
  isPlainObject,
  isArray: (value) => isArrayValue(value),
  isString: primitiveTypePredicate("string"),
  isNumber: primitiveTypePredicate("number"),
  isBoolean: primitiveTypePredicate("boolean"),
  isObject: (value, realm) => {
    const nullish = isNullish(value);
    if (nullish !== false) return nullish === null ? null : false;
    const typeofName = getTypeofName(value, realm);
    return typeofName === null ? null : typeofName === "object" || typeofName === "function";
  },
  isFunction: (value, realm) => {
    const typeofName = getTypeofName(value, realm);
    return typeofName === null ? null : typeofName === "function";
  },
};

const typePredicate = (helperName: string, test: StaticTypePredicate): StaticValue =>
  nativeFunction(helperName, ([argument = UNDEFINED_VALUE], tools) =>
    mapValue(argument, (alternative) =>
      decidedBooleanValue(
        test(alternative, tools.realm),
        `lodash ${helperName} of a value with an undecided type`,
      ),
    ),
  );

const MODELED_HELPERS = [
  ...TRANSPARENT_WRAPPERS,
  ...RATE_LIMITERS,
  ...Object.keys(MERGERS),
  "isEqual",
  ...Object.keys(TYPE_PREDICATES),
];

const getMethodPackageName = (helperName: string): string => `lodash.${helperName.toLowerCase()}`;

export const LODASH_MODELED_EXPORTS: ModeledExports = Object.fromEntries([
  ...LODASH_PACKAGES.flatMap((packageName): Array<[string, string[]]> => [
    [packageName, MODELED_HELPERS],
    ...MODELED_HELPERS.flatMap((helperName): Array<[string, string[]]> => [
      [`${packageName}/${helperName}`, ["default"]],
      [`${packageName}/${helperName}.js`, ["default"]],
    ]),
  ]),
  ...MODELED_HELPERS.map((helperName): [string, string[]] => [
    getMethodPackageName(helperName),
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
  const [packageName, ...modulePath] = specifier.split("/");
  if (LODASH_PACKAGES.includes(packageName)) {
    return modulePath.length === 1 && importedName === "default"
      ? modulePath[0].replace(/\.js$/, "")
      : importedName;
  }
  if (modulePath.length > 0 || importedName !== "default") return null;
  return (
    MODELED_HELPERS.find((helperName) => getMethodPackageName(helperName) === specifier) ?? null
  );
};

export const lodashValue: ExternalValueProvider = (specifier, importedName) => {
  const helperName = getHelperName(specifier, importedName);
  if (helperName === null) return null;
  if (helperName === "isEqual") return isEqual;
  if (helperName in MERGERS) return MERGERS[helperName];
  const test = Object.hasOwn(TYPE_PREDICATES, helperName) ? TYPE_PREDICATES[helperName] : null;
  if (test) return typePredicate(helperName, test);
  if (TRANSPARENT_WRAPPERS.includes(helperName)) return transparentWrapper(helperName);
  return RATE_LIMITERS.includes(helperName) ? rateLimiter(helperName) : null;
};

import {
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  isNullish,
  listValue,
  objectValue,
  setObjectProperty,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import type { LibraryValueProvider, StaticValue } from "../types.js";

// Vite's config helpers, as `vite.config.*` imports them: `defineConfig`
// returns its argument (it exists for typing) and `mergeConfig` deep-merges two
// config objects: nullish overrides are skipped, arrays concatenate, nested
// objects merge, anything else replaces. Vite+'s `defineConfig` injects its
// own plugins into a config object's `plugins` before handing it to Vite's. The
// rest of the Node APIs stay external.

export const VITE_PACKAGES = ["vite", "vitest", "vite-plus"];

const CONFIG_HELPER_SPECIFIERS = new Set(["vite", "vitest/config", "vite-plus"]);

const arraify = (value: StaticValue): StaticValue[] | null =>
  value.kind === "list" ? (hasDefiniteItems(value) ? value.items : null) : [value];

const mergeConfigValues = (existing: StaticValue, value: StaticValue, key: string): StaticValue => {
  if (existing.kind === "list" || value.kind === "list") {
    const existingItems = arraify(existing);
    const valueItems = arraify(value);
    return existingItems && valueItems
      ? listValue([...existingItems, ...valueItems])
      : unknownValue(`mergeConfig() of "${key}" arrays whose items are not statically known`);
  }
  return existing.kind === "object" && value.kind === "object"
    ? mergeConfigRecursively(existing, value)
    : value;
};

const mergeConfigRecursively = (defaults: StaticValue, overrides: StaticValue): StaticValue => {
  if (defaults.kind !== "object" || overrides.kind !== "object") {
    return unknownValue("mergeConfig() of values that are not plain objects");
  }
  const overrideKeys = getKnownObjectKeys(overrides);
  if (overrideKeys === null) return unknownValue("mergeConfig() with keys not statically known");
  const merged = objectValue([...defaults.entries]);
  for (const key of overrideKeys) {
    const value = getObjectProperty(overrides, key);
    const isValueNullish = isNullish(value);
    if (isValueNullish === true) continue;
    const existing = getObjectProperty(merged, key);
    const isExistingNullish = isNullish(existing);
    setObjectProperty(
      merged,
      key,
      isValueNullish === null || isExistingNullish === null
        ? unknownValue(`mergeConfig() of "${key}" whose presence is not statically known`)
        : isExistingNullish
          ? value
          : mergeConfigValues(existing, value, key),
    );
  }
  return merged;
};

const withInjectedPlugins = (config: StaticValue): StaticValue => {
  if (config.kind !== "object")
    return unknownValue("vite-plus defineConfig() of a config that is not a plain object");
  const injected = objectValue([...config.entries]);
  setObjectProperty(injected, "plugins", unknownValue("plugins vite-plus injects into the config"));
  return injected;
};

export const viteValue: LibraryValueProvider = (specifier, importedName) => {
  if (!CONFIG_HELPER_SPECIFIERS.has(specifier)) return null;
  switch (importedName) {
    case "defineConfig":
      return nativeFunction("defineConfig", ([config = UNDEFINED_VALUE]) =>
        specifier === "vite-plus" ? withInjectedPlugins(config) : config,
      );
    case "mergeConfig":
      return nativeFunction(
        "mergeConfig",
        ([defaults = UNDEFINED_VALUE, overrides = UNDEFINED_VALUE]) =>
          mergeConfigRecursively(defaults, overrides),
      );
    default:
      return null;
  }
};

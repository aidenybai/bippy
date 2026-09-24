import { resolvedPromiseValue } from "../evaluate/promises.js";
import { nativeFunction } from "../evaluate/stubs.js";
import {
  getObjectProperty,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
  isUndefinedValue,
  UNDEFINED_VALUE,
} from "../evaluate/values.js";
import type { LibraryValueProvider, ModeledExports, StaticValue } from "../types.js";

export const FLOATING_UI_PACKAGES = ["@floating-ui/core"];

const [PACKAGE_NAME] = FLOATING_UI_PACKAGES;

export const FLOATING_UI_MODELED_EXPORTS: ModeledExports = {
  [PACKAGE_NAME]: ["computePosition"],
};

const getOption = (options: StaticValue | undefined, key: string): StaticValue => {
  if (options === undefined || isUndefinedValue(options)) return UNDEFINED_VALUE;
  return options.kind === "object"
    ? getObjectProperty(options, key)
    : unknownValue(`Floating UI ${key} option`);
};

const getStringProperty = (
  value: StaticValue | undefined,
  key: string,
  fallback: string,
): StaticValue => {
  const property = getOption(value, key);
  if (isUndefinedValue(property)) return primitiveValue(fallback);
  return property.kind === "primitive" && typeof property.value === "string"
    ? property
    : unknownPrimitiveValue("string", `Floating UI ${key}`);
};

const computePosition = nativeFunction("computePosition", ([, , options], tools) => {
  const middleware = getOption(options, "middleware");
  const hasMiddleware =
    !isUndefinedValue(middleware) && !(middleware.kind === "list" && middleware.items.length === 0);
  if (hasMiddleware) tools.markEscaped(middleware);
  return resolvedPromiseValue(
    objectFromRecord({
      x: unknownPrimitiveValue("number", "Floating UI horizontal position"),
      y: unknownPrimitiveValue("number", "Floating UI vertical position"),
      placement: hasMiddleware
        ? unknownPrimitiveValue("string", "Floating UI middleware placement")
        : getStringProperty(options, "placement", "bottom"),
      strategy: getStringProperty(options, "strategy", "absolute"),
      middlewareData: hasMiddleware ? unknownValue("Floating UI middleware data") : objectValue(),
    }),
  );
});

export const floatingUiValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === PACKAGE_NAME && importedName === "computePosition" ? computePosition : null;

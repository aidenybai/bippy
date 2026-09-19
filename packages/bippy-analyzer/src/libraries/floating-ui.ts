import { resolvedPromiseValue } from "../evaluate/promises.js";
import { nativeFunction } from "../evaluate/stubs.js";
import {
  getObjectProperty,
  objectFromRecord,
  objectValue,
  primitiveValue,
} from "../evaluate/values.js";
import type { LibraryValueProvider, ModeledExports, StaticValue } from "../types.js";

export const FLOATING_UI_PACKAGES = ["@floating-ui/core"];

const [PACKAGE_NAME] = FLOATING_UI_PACKAGES;

export const FLOATING_UI_MODELED_EXPORTS: ModeledExports = {
  [PACKAGE_NAME]: ["computePosition"],
};

const stringProperty = (
  value: StaticValue | undefined,
  key: string,
  fallback: string,
): StaticValue => {
  if (value?.kind !== "object") return primitiveValue(fallback);
  const property = getObjectProperty(value, key);
  return property.kind === "primitive" && typeof property.value === "string"
    ? property
    : primitiveValue(fallback);
};

const computePosition = nativeFunction("computePosition", ([, , options]) =>
  resolvedPromiseValue(
    objectFromRecord({
      x: primitiveValue(0),
      y: primitiveValue(0),
      placement: stringProperty(options, "placement", "bottom"),
      strategy: stringProperty(options, "strategy", "absolute"),
      middlewareData: objectValue(),
    }),
  ),
);

export const floatingUiValue: LibraryValueProvider = (specifier, importedName) =>
  specifier === PACKAGE_NAME && importedName === "computePosition" ? computePosition : null;

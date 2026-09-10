import { nativeFunction } from "./stubs.js";
import type { JsonValue, SourceLocation, StaticValue } from "../types.js";
import { createErrorValue } from "./errors.js";
import {
  objectFromRecord,
  partialJsonValue,
  primitiveValue,
  thrownValue,
  toJsonValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const isOmitted = (value: StaticValue | undefined): boolean =>
  value === undefined || (value.kind === "primitive" && value.value === undefined);

const getLocales = (value: StaticValue | undefined): string | string[] | undefined | null => {
  if (isOmitted(value)) return undefined;
  const json = value === undefined ? undefined : toJsonValue(value);
  if (typeof json === "string") return json;
  if (Array.isArray(json) && json.every((item) => typeof item === "string")) return json;
  return null;
};

const getFormatOptions = (
  value: StaticValue | undefined,
): Record<string, JsonValue> | undefined | null => {
  if (isOmitted(value)) return undefined;
  const json = value === undefined ? undefined : toJsonValue(value);
  return json !== null && typeof json === "object" && !Array.isArray(json) ? json : null;
};

const toFormattable = (value: StaticValue | undefined): number | bigint | null => {
  if (value === undefined) return Number.NaN;
  if (value.kind !== "primitive") return null;
  if (typeof value.value === "number" || typeof value.value === "bigint") return value.value;
  return typeof value.value === "symbol" ? null : Number(value.value);
};

/**
 * `new Intl.NumberFormat(locales, options)` over statically known arguments,
 * formatting with the host ICU as the message formatter already does; invalid
 * options throw the RangeError the constructor raises.
 */
export const createNumberFormat = (
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const locales = getLocales(args[0]);
  const options = getFormatOptions(args[1]);
  if (locales === null || options === null)
    return unknownValue("Intl.NumberFormat() with dynamic arguments", location);
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locales, options);
  } catch (error) {
    return thrownValue(
      "Intl.NumberFormat() with invalid options",
      createErrorValue(
        error instanceof RangeError ? "RangeError" : "TypeError",
        [primitiveValue(error instanceof Error ? error.message : String(error))],
        location,
      ),
      location,
    );
  }
  return objectFromRecord({
    format: nativeFunction("format", ([value]) => {
      const number = toFormattable(value);
      return number === null
        ? unknownPrimitiveValue("string", "Intl.NumberFormat.format() of a dynamic number")
        : primitiveValue(formatter.format(number));
    }),
    resolvedOptions: nativeFunction("resolvedOptions", () =>
      partialJsonValue(
        Object.fromEntries(
          Object.entries(formatter.resolvedOptions()).filter(
            (entry): entry is [string, JsonValue] => entry[1] !== undefined,
          ),
        ),
        "Intl.NumberFormat.resolvedOptions()",
      ),
    ),
  });
};

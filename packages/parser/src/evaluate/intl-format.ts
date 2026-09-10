import { nativeFunction } from "./stubs.js";
import type { JsonValue, SourceLocation, StaticValue } from "../types.js";
import { isClockDateValue } from "./clock-date.js";
import { createErrorValue } from "./errors.js";
import { fromNativeValue, toNativeArguments } from "./native-values.js";
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

interface IntlService<Formatter> {
  name: "Intl.NumberFormat" | "Intl.DateTimeFormat";
  construct: (
    locales: string | string[] | undefined,
    options: Record<string, JsonValue> | undefined,
  ) => Formatter;
  toValue: (formatter: Formatter) => StaticValue;
}

const intlError = (reason: string, error: unknown, location: SourceLocation | null): StaticValue =>
  thrownValue(
    reason,
    createErrorValue(
      error instanceof RangeError ? "RangeError" : "TypeError",
      [primitiveValue(error instanceof Error ? error.message : String(error))],
      location,
    ),
    location,
  );

/** An `Intl` service over statically known arguments; invalid options throw the RangeError the constructor raises. */
const constructIntlService = <Formatter>(
  service: IntlService<Formatter>,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const locales = getLocales(args[0]);
  const options = getFormatOptions(args[1]);
  if (locales === null || options === null)
    return unknownValue(`${service.name}() with dynamic arguments`, location);
  let formatter: Formatter;
  try {
    formatter = service.construct(locales, options);
  } catch (error) {
    return intlError(`${service.name}() with invalid options`, error, location);
  }
  return service.toValue(formatter);
};

const resolvedOptionsValue = (
  name: string,
  formatter: Intl.NumberFormat | Intl.DateTimeFormat,
): StaticValue =>
  partialJsonValue(
    Object.fromEntries(
      Object.entries(formatter.resolvedOptions()).filter(
        (entry): entry is [string, JsonValue] => entry[1] !== undefined,
      ),
    ),
    `${name}.resolvedOptions()`,
  );

/** `new Intl.NumberFormat(locales, options)`, formatting with the host ICU as the message formatter already does. */
export const createNumberFormat = (
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue =>
  constructIntlService(
    {
      name: "Intl.NumberFormat",
      construct: (locales, options) => new Intl.NumberFormat(locales, options),
      toValue: (formatter) =>
        objectFromRecord({
          format: nativeFunction("format", ([value]) => {
            const number = toFormattable(value);
            return number === null
              ? unknownPrimitiveValue("string", "Intl.NumberFormat.format() of a dynamic number")
              : primitiveValue(formatter.format(number));
          }),
          resolvedOptions: nativeFunction("resolvedOptions", () =>
            resolvedOptionsValue("Intl.NumberFormat", formatter),
          ),
        }),
    },
    args,
    location,
  );

const CLOCK_DATE_REASON = "of the wall clock";

/** The dates a `DateTimeFormat` method formats, or the reason they are not statically known. */
const toFormattableDates = (args: StaticValue[]): unknown[] | string => {
  if (args.some(isClockDateValue)) return CLOCK_DATE_REASON;
  if (
    args.some((argument) => argument.kind === "unknown-primitive" && argument.clock !== undefined)
  )
    return CLOCK_DATE_REASON;
  const natives = toNativeArguments(args, null);
  return natives ?? "of a dynamic date";
};

type DateTimeFormatMethod = "format" | "formatToParts" | "formatRange" | "formatRangeToParts";

const dateTimeFormatMethod = (
  formatter: Intl.DateTimeFormat,
  name: DateTimeFormatMethod,
  isStringResult: boolean,
  location: SourceLocation | null,
): StaticValue =>
  nativeFunction(name, (dates) => {
    const natives = dates.length === 0 ? CLOCK_DATE_REASON : toFormattableDates(dates);
    if (typeof natives === "string") {
      const reason = `Intl.DateTimeFormat.${name}() ${natives}`;
      return isStringResult
        ? unknownPrimitiveValue("string", reason)
        : unknownValue(reason, location);
    }
    try {
      return fromNativeValue(
        Reflect.apply(formatter[name], formatter, natives),
        `Intl.DateTimeFormat.${name}()`,
        null,
      );
    } catch (error) {
      return intlError(`Intl.DateTimeFormat.${name}() of an invalid date`, error, location);
    }
  });

/**
 * `new Intl.DateTimeFormat(locales, options)`: a known date formats through the
 * host ICU; the wall clock (an omitted argument, `new Date()`, `Date.now()`)
 * formats to a runtime-only string.
 */
export const createDateTimeFormat = (
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue =>
  constructIntlService(
    {
      name: "Intl.DateTimeFormat",
      construct: (locales, options) => new Intl.DateTimeFormat(locales, options),
      toValue: (formatter) =>
        objectFromRecord({
          format: dateTimeFormatMethod(formatter, "format", true, location),
          formatToParts: dateTimeFormatMethod(formatter, "formatToParts", false, location),
          formatRange: dateTimeFormatMethod(formatter, "formatRange", true, location),
          formatRangeToParts: dateTimeFormatMethod(
            formatter,
            "formatRangeToParts",
            false,
            location,
          ),
          resolvedOptions: nativeFunction("resolvedOptions", () =>
            resolvedOptionsValue("Intl.DateTimeFormat", formatter),
          ),
        }),
    },
    args,
    location,
  );

import type { NumberRange, StaticObjectValue, StaticValue } from "../types.js";
import { rangedNumberValue } from "./number-ranges.js";
import { objectFromRecord, objectValue, unknownPrimitiveValue } from "./values.js";

interface DateModel {
  /** The time value, or unknown once a setter ran. */
  time: () => StaticValue;
  /** Whether the calendar bounds the components: false for a date that may be invalid. */
  isBounded: boolean;
}

const dates = new WeakMap<StaticObjectValue, DateModel>();

const COMPONENT_RANGES: Record<string, NumberRange> = {
  getMonth: { min: 0, max: 11 },
  getDate: { min: 1, max: 31 },
  getDay: { min: 0, max: 6 },
  getHours: { min: 0, max: 23 },
  getMinutes: { min: 0, max: 59 },
  getSeconds: { min: 0, max: 59 },
  getMilliseconds: { min: 0, max: 999 },
};

const UNBOUNDED_GETTERS = ["getFullYear", "getUTCFullYear", "getYear", "getTimezoneOffset"];

const STRING_METHODS = [
  "toString",
  "toDateString",
  "toTimeString",
  "toISOString",
  "toUTCString",
  "toJSON",
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
];

const SETTERS = [
  "setTime",
  "setFullYear",
  "setMonth",
  "setDate",
  "setHours",
  "setMinutes",
  "setSeconds",
  "setMilliseconds",
];

const DATE_CONSTRUCTOR: StaticValue = { kind: "global", name: "Date" };

const nativeMethod = (name: string, call: () => StaticValue): StaticValue => ({
  kind: "native-function",
  name,
  call,
});

/** Whether `value` is a `Date` the analysis modeled (see `createClockDateValue`). */
export const isClockDateValue = (value: StaticValue): boolean =>
  value.kind === "object" && dates.has(value);

const createDateValue = (reading: StaticValue, isBounded: boolean): StaticValue => {
  let isMutated = false;
  const describe = (name: string): string => `new Date().${name}()`;
  const time = (name: string): StaticValue =>
    isMutated ? unknownPrimitiveValue("number", `${describe(name)} after a setter`) : reading;
  const component = (name: string, range: NumberRange): StaticValue =>
    isBounded
      ? rangedNumberValue(describe(name), range)
      : unknownPrimitiveValue("number", describe(name));
  const members: Record<string, StaticValue> = {
    constructor: DATE_CONSTRUCTOR,
    getTime: nativeMethod("getTime", () => time("getTime")),
    valueOf: nativeMethod("valueOf", () => time("valueOf")),
  };
  for (const [name, range] of Object.entries(COMPONENT_RANGES)) {
    members[name] = nativeMethod(name, () => component(name, range));
    const utcName = name.replace("get", "getUTC");
    members[utcName] = nativeMethod(utcName, () => component(utcName, range));
  }
  for (const name of UNBOUNDED_GETTERS) {
    members[name] = nativeMethod(name, () => unknownPrimitiveValue("number", describe(name)));
  }
  for (const name of STRING_METHODS) {
    members[name] = nativeMethod(name, () => unknownPrimitiveValue("string", describe(name)));
  }
  for (const name of SETTERS) {
    members[name] = nativeMethod(name, () => {
      isMutated = true;
      return unknownPrimitiveValue("number", describe(name));
    });
  }
  const date = objectValue([]);
  date.prototype = objectFromRecord(members);
  dates.set(date, { time: () => time("getTime"), isBounded });
  return date;
};

/**
 * `new Date()` (or `new Date(<clock reading>)`): a date the wall clock decides.
 * `getTime()` yields the reading it was built from; the calendar components and
 * string forms are unknown, bounded where the calendar bounds them.
 */
export const createClockDateValue = (reading: StaticValue): StaticValue =>
  createDateValue(reading, true);

/** `new Date(<unknown number>)`: a date of a time the analysis does not know, which may be invalid, so nothing bounds its components. */
export const createUnknownDateValue = (time: StaticValue): StaticValue =>
  createDateValue(time, false);

/** `new Date(date)` on a modeled date: a copy holding the same time; null for any other argument. */
export const cloneDateValue = (value: StaticValue): StaticValue | null => {
  const model = value.kind === "object" ? dates.get(value) : undefined;
  return model === undefined ? null : createDateValue(model.time(), model.isBounded);
};

/** `ToPrimitive` of a modeled date: its time under the number hint (`+date`, `<`), its string form otherwise (`date + ""`); null for other values. */
export const toDatePrimitive = (
  value: StaticValue,
  hint: "default" | "number",
): StaticValue | null => {
  const model = value.kind === "object" ? dates.get(value) : undefined;
  if (model === undefined) return null;
  return hint === "number"
    ? model.time()
    : unknownPrimitiveValue("string", "new Date().toString()");
};

export const isClockReading = (value: StaticValue): boolean =>
  value.kind === "unknown-primitive" && value.clock !== undefined;

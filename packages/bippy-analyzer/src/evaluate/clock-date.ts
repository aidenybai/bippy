import type { NumberRange, StaticObjectValue, StaticValue } from "../types.js";
import { rangedNumberValue } from "./primitive-shapes.js";
import { objectFromRecord, objectValue, unknownPrimitiveValue } from "./values.js";

const clockDates = new WeakSet<StaticObjectValue>();

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

const nativeMethod = (name: string, call: () => StaticValue): StaticValue => ({
  kind: "native-function",
  name,
  call,
});

export const isClockDateValue = (value: StaticValue): boolean =>
  value.kind === "object" && clockDates.has(value);

/**
 * `new Date()` (or `new Date(<clock reading>)`): a date the wall clock decides.
 * `getTime()` yields the reading it was built from; the calendar components and
 * string forms are unknown, bounded where the calendar bounds them.
 */
export const createClockDateValue = (reading: StaticValue): StaticValue => {
  let isMutated = false;
  const describe = (name: string): string => `new Date().${name}()`;
  const time = (name: string): StaticValue =>
    isMutated ? unknownPrimitiveValue("number", `${describe(name)} after a setter`) : reading;
  const members: Record<string, StaticValue> = {
    getTime: nativeMethod("getTime", () => time("getTime")),
    valueOf: nativeMethod("valueOf", () => time("valueOf")),
  };
  for (const [name, range] of Object.entries(COMPONENT_RANGES)) {
    members[name] = nativeMethod(name, () => rangedNumberValue(describe(name), range));
    const utcName = name.replace("get", "getUTC");
    members[utcName] = nativeMethod(utcName, () => rangedNumberValue(describe(utcName), range));
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
  clockDates.add(date);
  return date;
};

export const isClockReading = (value: StaticValue): boolean =>
  value.kind === "unknown-primitive" && value.clock !== undefined;

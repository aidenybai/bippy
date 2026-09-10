import type {
  CapturedCalendarFields,
  CapturedClockWindow,
  NumberRange,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import { rangedNumberValue } from "./primitive-shapes.js";
import { objectFromRecord, objectValue, primitiveValue, unknownPrimitiveValue } from "./values.js";

const clockDates = new WeakSet<StaticObjectValue>();

type CalendarField = keyof CapturedCalendarFields;

/** Coarsest first: a field's range only follows the window when every coarser field agrees at both ends. */
const ORDERED_FIELDS: readonly CalendarField[] = [
  "year",
  "month",
  "date",
  "hours",
  "minutes",
  "seconds",
  "milliseconds",
];

const CALENDAR_RANGES: Record<CalendarField, NumberRange | null> = {
  year: null,
  month: { min: 0, max: 11 },
  date: { min: 1, max: 31 },
  day: { min: 0, max: 6 },
  hours: { min: 0, max: 23 },
  minutes: { min: 0, max: 59 },
  seconds: { min: 0, max: 59 },
  milliseconds: { min: 0, max: 999 },
};

const GETTER_FIELDS: Record<string, CalendarField> = {
  getFullYear: "year",
  getMonth: "month",
  getDate: "date",
  getDay: "day",
  getHours: "hours",
  getMinutes: "minutes",
  getSeconds: "seconds",
  getMilliseconds: "milliseconds",
};

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

const isSameCalendarDate = (start: CapturedCalendarFields, end: CapturedCalendarFields): boolean =>
  start.year === end.year && start.month === end.month && start.date === end.date;

/**
 * What a calendar getter can return for an instant inside the window, in the
 * fields (local or UTC) it reads: the window's own bounds while every coarser
 * field agrees at both ends, the calendar's bounds once one wraps.
 */
export const getWindowedFieldRange = (
  start: CapturedCalendarFields,
  end: CapturedCalendarFields,
  field: CalendarField,
): NumberRange | null => {
  if (field === "day") {
    return isSameCalendarDate(start, end) ? { min: start.day, max: end.day } : CALENDAR_RANGES.day;
  }
  for (const coarser of ORDERED_FIELDS) {
    if (coarser === field) return { min: start[field], max: end[field] };
    if (start[coarser] !== end[coarser]) return CALENDAR_RANGES[field];
  }
  return CALENDAR_RANGES[field];
};

/** A window whose ends disagree on the UTC offset (a DST change between them) cannot bound the local fields. */
const readWindowFields = (
  window: CapturedClockWindow,
  isUtc: boolean,
): [CapturedCalendarFields, CapturedCalendarFields] | null => {
  if (window.end.time < window.start.time) return null;
  if (isUtc) return [window.start.utc, window.end.utc];
  if (window.start.timezoneOffset !== window.end.timezoneOffset) return null;
  return [window.start.local, window.end.local];
};

const numberInRange = (reason: string, range: NumberRange | null): StaticValue => {
  if (range === null) return unknownPrimitiveValue("number", reason);
  return range.min === range.max ? primitiveValue(range.min) : rangedNumberValue(reason, range);
};

const offsetRange = (range: NumberRange | null, offset: number): NumberRange | null =>
  range && { min: range.min + offset, max: range.max + offset };

export const getClockFieldRange = (
  window: CapturedClockWindow | null,
  field: CalendarField,
  isUtc: boolean,
): NumberRange | null => {
  const fields = window && readWindowFields(window, isUtc);
  return fields ? getWindowedFieldRange(fields[0], fields[1], field) : CALENDAR_RANGES[field];
};

export const getClockTimezoneOffset = (window: CapturedClockWindow | null): number | null =>
  window && window.start.timezoneOffset === window.end.timezoneOffset
    ? window.start.timezoneOffset
    : null;

/**
 * `new Date()` (or `new Date(<clock reading>)`): a date the wall clock decides.
 * `getTime()` yields the reading it was built from; the calendar components and
 * string forms are unknown, bounded by the calendar and, when the capture
 * recorded the clock at both ends of the page's life, by that window.
 */
export const createClockDateValue = (
  reading: StaticValue,
  window: CapturedClockWindow | null,
): StaticValue => {
  let isMutated = false;
  const describe = (name: string): string => `new Date().${name}()`;
  const time = (name: string): StaticValue =>
    isMutated ? unknownPrimitiveValue("number", `${describe(name)} after a setter`) : reading;
  const fieldRange = (field: CalendarField, isUtc: boolean): NumberRange | null =>
    getClockFieldRange(window, field, isUtc);
  const members: Record<string, StaticValue> = {
    getTime: nativeMethod("getTime", () => time("getTime")),
    valueOf: nativeMethod("valueOf", () => time("valueOf")),
    getYear: nativeMethod("getYear", () =>
      numberInRange(describe("getYear"), offsetRange(fieldRange("year", false), -1900)),
    ),
    getTimezoneOffset: nativeMethod("getTimezoneOffset", () => {
      const observed = getClockTimezoneOffset(window);
      return observed === null
        ? unknownPrimitiveValue("number", describe("getTimezoneOffset"))
        : primitiveValue(observed);
    }),
  };
  for (const [name, field] of Object.entries(GETTER_FIELDS)) {
    members[name] = nativeMethod(name, () =>
      numberInRange(describe(name), fieldRange(field, false)),
    );
    const utcName = name.replace("get", "getUTC");
    members[utcName] = nativeMethod(utcName, () =>
      numberInRange(describe(utcName), fieldRange(field, true)),
    );
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

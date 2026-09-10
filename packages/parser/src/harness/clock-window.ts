import type { CapturedCalendarFields, CapturedClockTime } from "../types.js";

const readLocalFields = (date: Date): CapturedCalendarFields => ({
  year: date.getFullYear(),
  month: date.getMonth(),
  date: date.getDate(),
  day: date.getDay(),
  hours: date.getHours(),
  minutes: date.getMinutes(),
  seconds: date.getSeconds(),
  milliseconds: date.getMilliseconds(),
});

const readUtcFields = (date: Date): CapturedCalendarFields => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth(),
  date: date.getUTCDate(),
  day: date.getUTCDay(),
  hours: date.getUTCHours(),
  minutes: date.getUTCMinutes(),
  seconds: date.getUTCSeconds(),
  milliseconds: date.getUTCMilliseconds(),
});

export const readClockTime = (date: Date): CapturedClockTime => ({
  time: date.getTime(),
  timezoneOffset: date.getTimezoneOffset(),
  local: readLocalFields(date),
  utc: readUtcFields(date),
});

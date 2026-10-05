// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-date-objects */

import type { ISODateTimeRecord } from '../intrinsics/Temporal/PlainDateTime.mts';
import { ThrowCompletion, X } from '../completion.mts';
import { GetGlobalObject } from '../execution-context/ExecutionContext.mts';
import { surroundingAgent } from '../execution-context/Agent.mts';
import { DateParser, ParseTimeZoneIdentifier } from '../parser/TemporalParser.mts';
import {
  ToIntegerOrInfinity,
  Assert,
  type Integer,
  type IntegralNumber,
  type NaN,
  type Num,
} from './all.mts';
import { clamp, floorDiv, modulo, truncateDiv } from './math.mts';
import {
  GetNamedTimeZoneEpochNanoseconds,
  GetNamedTimeZoneOffsetNanoseconds,
  SystemTimeZoneIdentifier,
} from './temporal/addition.mts';
import { TimeValueToISODateTimeRecord } from './temporal/plain-date-time.mts';
import type { EpochNanoseconds } from './temporal/temporal.mts';
import { NumberValue, ObjectValue, Value, type PlainCompletion } from '#self';

/** https://tc39.es/ecma262/pr/3759/#sec-time-values-and-time-range */
export type FiniteTimeValue = IntegralNumber;
export type TimeValue = FiniteTimeValue | NaN;

/** https://tc39.es/ecma262/pr/3759/#sec-time-related-constants */
export const HoursPerDay = 24n;
export const MinutesPerHour = 60n;
export const SecondsPerMinute = 60n;
export const MillisecondsPerSecond = 1000n;
export const NanosecondsPerSecond = 10n ** 9n;
export const NanosecondsPerMillisecond = 10n ** 6n;
export const NanosecondsPerMicrosecond = 10n ** 3n;
export const NanosecondsPerMinute = NanosecondsPerSecond * SecondsPerMinute;
export const NanosecondsPerHour = NanosecondsPerMinute * MinutesPerHour;
export const MillisecondsPerMinute = MillisecondsPerSecond * SecondsPerMinute;
export const MillisecondsPerHour = MillisecondsPerMinute * MinutesPerHour;
export const MillisecondsPerDay = MillisecondsPerHour * HoursPerDay;
export const NanosecondsPerDay = 10n ** 6n * MillisecondsPerDay;
export const MaxEpochNanoseconds = 10n ** 8n * NanosecondsPerDay;
export const MinEpochNanoseconds = -MaxEpochNanoseconds;

/** https://tc39.es/ecma262/#sec-day-number-and-time-within-day */
export function Day(t: FiniteTimeValue): Integer {
  return floorDiv(BigInt(t), MillisecondsPerDay);
}

export function TimeWithinDay(t: FiniteTimeValue): Integer {
  return modulo(BigInt(t), MillisecondsPerDay);
}

/** https://tc39.es/ecma262/#sec-dayfromyear */
export function DayFromYear(y: Integer): Integer {
  const numYears1 = y - 1970n;
  const numYears4 = floorDiv(y - 1969n, 4n);
  const numYears100 = floorDiv(y - 1901n, 100n);
  const numYears400 = floorDiv(y - 1601n, 400n);
  return 365n * numYears1 + numYears4 - numYears100 + numYears400;
}

export function TimeFromYear(y: Integer): TimeValue {
  return Number(MillisecondsPerDay * DayFromYear(y)) as TimeValue;
}

export function YearFromTime(t: FiniteTimeValue): Integer {
  const msPerAverageYear = 12 * 30.436875 * Number(MillisecondsPerDay);
  let year = BigInt(Math.floor(((t + msPerAverageYear / 2) / msPerAverageYear) + 1970));
  if (TimeFromYear(year) > t) {
    year -= 1n;
  }
  return year;
}

export function DayWithinYear(t: FiniteTimeValue): Integer {
  return Day(t) - DayFromYear(YearFromTime(t));
}

export function InLeapYear(t: FiniteTimeValue): 0n | 1n {
  const y = YearFromTime(t);
  if (modulo(y, 400n) === 0n) return 1n;
  if (modulo(y, 100n) === 0n) return 0n;
  if (modulo(y, 4n) === 0n) return 1n;
  return 0n;
}

/** https://tc39.es/ecma262/#sec-month-number */
export function MonthFromTime(t: FiniteTimeValue): Integer {
  const inLeapYear = InLeapYear(t);
  const dayWithinYear = DayWithinYear(t);
  if (dayWithinYear < 31n) return 0n;
  if (dayWithinYear < 59n + inLeapYear) return 1n;
  if (dayWithinYear < 90n + inLeapYear) return 2n;
  if (dayWithinYear < 120n + inLeapYear) return 3n;
  if (dayWithinYear < 151n + inLeapYear) return 4n;
  if (dayWithinYear < 181n + inLeapYear) return 5n;
  if (dayWithinYear < 212n + inLeapYear) return 6n;
  if (dayWithinYear < 243n + inLeapYear) return 7n;
  if (dayWithinYear < 273n + inLeapYear) return 8n;
  if (dayWithinYear < 304n + inLeapYear) return 9n;
  if (dayWithinYear < 334n + inLeapYear) return 10n;
  Assert(dayWithinYear < 365n + inLeapYear);
  return 11n;
}

/** https://tc39.es/ecma262/#sec-date-number */
export function DateFromTime(t: FiniteTimeValue): Integer {
  const inLeapYear = InLeapYear(t);
  const dayWithinYear = DayWithinYear(t);
  const month = MonthFromTime(t);
  switch (month) {
    case 0n: return dayWithinYear + 1n;
    case 1n: return dayWithinYear - 30n;
    case 2n: return dayWithinYear - 58n - inLeapYear;
    case 3n: return dayWithinYear - 89n - inLeapYear;
    case 4n: return dayWithinYear - 119n - inLeapYear;
    case 5n: return dayWithinYear - 150n - inLeapYear;
    case 6n: return dayWithinYear - 180n - inLeapYear;
    case 7n: return dayWithinYear - 211n - inLeapYear;
    case 8n: return dayWithinYear - 242n - inLeapYear;
    case 9n: return dayWithinYear - 272n - inLeapYear;
    case 10n: return dayWithinYear - 303n - inLeapYear;
    default:
  }
  Assert(month === 11n);
  return dayWithinYear - 333n - inLeapYear;
}

/** https://tc39.es/ecma262/#sec-week-day */
export function WeekDay(t: FiniteTimeValue): Integer {
  return modulo(Day(t) + 4n, 7n);
}

/** https://tc39.es/ecma262/#sec-hours-minutes-second-and-milliseconds */
export function HourFromTime(t: FiniteTimeValue): Integer {
  return modulo(floorDiv(BigInt(t), MillisecondsPerHour), HoursPerDay);
}

export function MinuteFromTime(t: FiniteTimeValue): Integer {
  return modulo(floorDiv(BigInt(t), MillisecondsPerMinute), MinutesPerHour);
}

export function SecondFromTime(t: FiniteTimeValue): Integer {
  return modulo(floorDiv(BigInt(t), MillisecondsPerSecond), SecondsPerMinute);
}

export function MillisecondFromTime(t: FiniteTimeValue): Integer {
  return modulo(BigInt(t), MillisecondsPerSecond);
}

/** https://tc39.es/ecma262/#sec-getutcepochnanoseconds */
export function GetUTCEpochNanoseconds(
  isoDateTime: ISODateTimeRecord,
): EpochNanoseconds {
  const date = MakeDay(Number(isoDateTime.ISODate.Year), Number(isoDateTime.ISODate.Month - 1n), Number(isoDateTime.ISODate.Day));
  const time = MakeTime(Number(isoDateTime.Time.Hour), Number(isoDateTime.Time.Minute), Number(isoDateTime.Time.Second), Number(isoDateTime.Time.Millisecond));
  const epochMilliseconds = MakeDate(date, time);
  Assert(Value(epochMilliseconds).isIntegralNumber());
  return BigInt(epochMilliseconds) * NanosecondsPerMillisecond + isoDateTime.Time.Microsecond * NanosecondsPerMicrosecond + isoDateTime.Time.Nanosecond;
}

/** https://tc39.es/ecma262/#sec-localtime */
export function LocalTime(tv: FiniteTimeValue): IntegralNumber {
  const systemTimeZoneIdentifier = SystemTimeZoneIdentifier();
  const parseResult = X(ParseTimeZoneIdentifier(systemTimeZoneIdentifier));
  let offsetNanoseconds: bigint;
  if (parseResult.OffsetMinutes !== undefined) {
    offsetNanoseconds = parseResult.OffsetMinutes * NanosecondsPerMinute;
  } else {
    offsetNanoseconds = GetNamedTimeZoneOffsetNanoseconds(systemTimeZoneIdentifier, BigInt(tv) * NanosecondsPerMillisecond);
  }
  const offsetMilliseconds = truncateDiv(offsetNanoseconds, NanosecondsPerMillisecond);
  return tv + Number(offsetMilliseconds);
}

/** https://tc39.es/ecma262/#sec-utc-t */
export function UTC(t: Num): TimeValue {
  if (!Number.isFinite(t)) return NaN as NaN;
  const systemTimeZoneIdentifier = SystemTimeZoneIdentifier();
  const parseResult = X(ParseTimeZoneIdentifier(systemTimeZoneIdentifier));
  let offsetNanoseconds: bigint;
  if (parseResult.OffsetMinutes !== undefined) {
    offsetNanoseconds = parseResult.OffsetMinutes * NanosecondsPerMinute;
  } else {
    const isoDateTime = TimeValueToISODateTimeRecord(t);
    const possibleInstants = GetNamedTimeZoneEpochNanoseconds(systemTimeZoneIdentifier, isoDateTime);
    let disambiguatedInstant: EpochNanoseconds;
    if (possibleInstants.length > 0) {
      disambiguatedInstant = possibleInstants[0];
    } else {
      let tBefore = Math.floor(t) - 1;
      let possibleInstantsBefore: EpochNanoseconds[] = [];
      while (possibleInstantsBefore.length === 0) {
        possibleInstantsBefore = GetNamedTimeZoneEpochNanoseconds(systemTimeZoneIdentifier, TimeValueToISODateTimeRecord(tBefore));
        tBefore -= 1;
      }
      disambiguatedInstant = possibleInstantsBefore[possibleInstantsBefore.length - 1];
    }
    offsetNanoseconds = GetNamedTimeZoneOffsetNanoseconds(systemTimeZoneIdentifier, disambiguatedInstant);
  }
  const offsetMilliseconds = truncateDiv(offsetNanoseconds, NanosecondsPerMillisecond);
  return t - Number(offsetMilliseconds) as TimeValue;
}

/** https://tc39.es/ecma262/#sec-maketime */
export function MakeTime(hour: Num, minute: Num, second: Num, millisecond: Num): Num {
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second) || !Number.isFinite(millisecond)) {
    return NaN;
  }
  const hourMV = X(ToIntegerOrInfinity(hour));
  const minuteMV = X(ToIntegerOrInfinity(minute));
  const secondMV = X(ToIntegerOrInfinity(second));
  const millisecondMV = X(ToIntegerOrInfinity(millisecond));
  return ((hourMV * Number(MillisecondsPerHour) + minuteMV * Number(MillisecondsPerMinute)) + secondMV * Number(MillisecondsPerSecond)) + millisecondMV;
}

const daysWithinYearToEndOfMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

/** https://tc39.es/ecma262/#sec-makeday */
export function MakeDay(year: Num, month: Num, day: Num): Num | NaN {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return NaN;
  }
  const yearMV = X(ToIntegerOrInfinity(year));
  const monthMV = X(ToIntegerOrInfinity(month));
  const dayNumber = X(ToIntegerOrInfinity(day));
  const ym = yearMV + Math.floor(monthMV / 12);
  if (!Number.isFinite(ym)) return NaN;
  const mn = modulo(monthMV, 12);
  // Find a finite time value t such that YearFromTime(t) = ℝ(ym), MonthFromTime(t) = mn, and DateFromTime(t) = 1; but if this is not possible (because some argument is out of range), return NaN.
  const ymday = Number(DayFromYear(BigInt(ym + (mn > 1 ? 1 : 0)))) - 365 * (mn > 1 ? 1 : 0) + daysWithinYearToEndOfMonth[mn];
  const t = Math.floor(ymday * Number(MillisecondsPerDay));
  if (!Number.isFinite(t)) return NaN;
  return Number(Day(t)) + dayNumber - 1;
}

/** https://tc39.es/ecma262/#sec-makedate */
export function MakeDate(day: Num, time: Num): Num | NaN {
  if (!Number.isFinite(day) || !Number.isFinite(time)) {
    return NaN;
  }
  const tv = day * Number(MillisecondsPerDay) + time;
  if (!Number.isFinite(tv)) {
    return NaN;
  }
  return tv;
}

/** https://tc39.es/ecma262/#sec-makefullyear */
export function MakeFullYear(year: NumberValue): IntegralNumber | NaN {
  if (year.isNaN() || year.isInfinity()) return NaN;
  const truncated = X(ToIntegerOrInfinity(year));
  if (truncated >= 0 && truncated <= 99) {
    return 1900 + truncated;
  }
  return truncated;
}


/** https://tc39.es/ecma262/#sec-timeclip */
export function TimeClip(time: Num): TimeValue {
  // 1. If time is not finite, return NaN.
  if (!Number.isFinite(time)) {
    return NaN;
  }
  // 2. If abs(ℝ(time)) > 8.64 × 1015, return NaN.
  if (Math.abs(time) > 8.64e15) {
    return NaN;
  }
  // 3. Return 𝔽(! ToIntegerOrInfinity(time)).
  return X(ToIntegerOrInfinity(time));
}

/** https://tc39.es/ecma262/#sec-isoffsettimezoneidentifier */
export function IsOffsetTimeZoneIdentifier(offsetString: string): boolean {
  const parseResult = DateParser.parse(offsetString, (parser) => parser.parseUTCOffset());
  if (Array.isArray(parseResult)) return false;
  return true;
}

/** https://tc39.es/ecma262/#sec-parsedatetimeutcoffset */
export function ParseDateTimeUTCOffset(offsetString: string): PlainCompletion<bigint> {
  const parseResult = DateParser.parse(
    offsetString,
    (parser) => parser.parseUTCOffset(),
    { SubMinutePrecision: true, RangeError: true },
  );
  if (Array.isArray(parseResult)) return ThrowCompletion(parseResult[0]);
  Assert(!!parseResult.Sign);
  const sign = parseResult.Sign === '-' ? -1n : 1n;
  Assert(parseResult.Hour !== undefined);
  const hours = BigInt(parseResult.Hour);
  const minutes = parseResult.Minute ? BigInt(parseResult.Minute) : 0n;
  const seconds = parseResult.Second ? BigInt(parseResult.Second) : 0n;
  let nanoseconds;
  if (!parseResult.TemporalDecimalFraction) {
    nanoseconds = 0n;
  } else {
    const fraction = `${parseResult.TemporalDecimalFraction.separator + parseResult.TemporalDecimalFraction.digits}000000000`;
    const nanosecondsString = fraction.substring(1, 10);
    nanoseconds = BigInt(nanosecondsString);
  }
  return sign * (((hours * MinutesPerHour + minutes) * SecondsPerMinute + seconds) * NanosecondsPerSecond + nanoseconds);
}

/** https://tc39.es/ecma262/#sec-hostsystemutcepochnanoseconds */
export function HostSystemUTCEpochNanoseconds(global: ObjectValue): EpochNanoseconds {
  let host = surroundingAgent.hostDefinedOptions.hostHooks?.HostSystemUTCEpochNanoseconds?.(global);
  if (host === undefined) {
    host = BigInt(Date.now()) * NanosecondsPerMillisecond as EpochNanoseconds;
  }
  return clamp(MinEpochNanoseconds, host, MaxEpochNanoseconds);
}

/** https://tc39.es/ecma262/#sec-systemutcepochmilliseconds */
export function SystemUTCEpochMilliseconds(): IntegralNumber {
  const global = GetGlobalObject();
  const nowEpochNanoseconds = HostSystemUTCEpochNanoseconds(global);
  return Number(floorDiv(nowEpochNanoseconds, NanosecondsPerMillisecond));
}

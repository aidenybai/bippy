import type { TemporalDurationObject } from '../../intrinsics/Temporal/Duration.mts';
import { type ISODateRecord, type TemporalPlainDateObject, isTemporalPlainDateObject } from '../../intrinsics/Temporal/PlainDate.mts';
import { type ISODateTimeRecord, isTemporalPlainDateTimeObject } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { isTemporalZonedDateTimeObject } from '../../intrinsics/Temporal/ZonedDateTime.mts';
import { ParseISODateTime } from '../../parser/TemporalParser.mts';
import {
  abs, max, min, truncateDiv,
} from '../math.mts';
import { GetUTCEpochNanoseconds } from '../date-objects.mts';
import { NoTimeZone, ToZeroPaddedDecimalString } from './addition.mts';
import {
  Assert, type KnownCalendarType, type FunctionObject, type ValueEvaluator, Throw, surroundingAgent, Q, OrdinaryCreateFromConstructor, type Mutable, Value, ObjectValue, GetTemporalOverflowOption, X, GetISODateTimeFor, GetTemporalCalendarIdentifierWithISODefault, PrepareCalendarFields, CalendarDateFromFields, JSStringValue, CanonicalizeCalendar, CalendarISOToDate, type PlainCompletion, ISODaysInMonth, ISODateToEpochDays, EpochDaysToEpochMilliseconds, YearFromTime, MonthFromTime, DateFromTime, FormatCalendarAnnotation, GetDifferenceSettings, CreateTemporalDuration, CalendarDateUntil, type DateUnit, CombineDateAndTimeDuration, RoundRelativeDuration, TemporalDurationFromInternal, CreateNegatedTemporalDuration, ToTemporalDuration, CalendarDateAdd,
  BalanceISOYearMonth,
  MidnightTimeRecord,
  NoonTimeRecord,
  ISODateTimeWithinLimits,
  ToInternalDurationRecordWith24HourDays,
  NanosecondsPerDay,
  CreateDateDurationRecord,
  type CalendarDateRecord,
  type Integer,
  type FiniteTimeValue,
  GetOptionsObject,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal-create-iso-date-record */
export function CreateISODateRecord(y: Integer, m: Integer, d: Integer): PlainCompletion<ISODateRecord> {
  if (!IsValidISODate(y, m, d)) {
    return Throw.RangeError('$1-$2-$3 is not a valid ISO date', y, m, d);
  }
  return { Year: y, Month: m, Day: d };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtemporaldate */
export function* CreateTemporalDate(isoDate: ISODateRecord, calendar: KnownCalendarType, NewTarget?: FunctionObject): ValueEvaluator<TemporalPlainDateObject> {
  if (!ISODateWithinLimits(isoDate)) {
    return Throw.RangeError('$1-$2-$3 is not a valid date', isoDate.Year, isoDate.Month, isoDate.Day);
  }
  if (NewTarget === undefined) {
    NewTarget = surroundingAgent.intrinsic('%Temporal.PlainDate%');
  }
  const object = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%Temporal.PlainDate.prototype%', [
    'InitializedTemporalDate',
    'ISODate',
    'Calendar',
  ])) as Mutable<TemporalPlainDateObject>;
  object.ISODate = isoDate;
  object.Calendar = calendar;
  return object;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporaldate */
export function* ToTemporalDate(item: Value, options: Value = Value.undefined): ValueEvaluator<TemporalPlainDateObject> {
  if (item instanceof ObjectValue) {
    if (isTemporalPlainDateObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalDate(item.ISODate, item.Calendar));
    }
    if (isTemporalZonedDateTimeObject(item)) {
      const isoDateTime = GetISODateTimeFor(item.TimeZone, item.EpochNanoseconds);
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalDate(isoDateTime.ISODate, item.Calendar));
    }
    if (isTemporalPlainDateTimeObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalDate(item.ISODateTime.ISODate, item.Calendar));
    }
    const calendar = Q(yield* GetTemporalCalendarIdentifierWithISODefault(item));
    const fields = Q(yield* PrepareCalendarFields(calendar, item, 'date-fields', 'no-non-calendar-fields', 'no-required-fields'));
    const resolvedOptions = Q(GetOptionsObject(options));
    const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
    const isoDate = Q(yield* CalendarDateFromFields(calendar, fields, overflow));
    return X(CreateTemporalDate(isoDate, calendar));
  }
  if (!(item instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', item);
  }
  const result = Q(ParseISODateTime(item.stringValue(), 'plain-date-time'));
  const calendar = result.Calendar ?? 'iso8601';
  const calendarType = Q(CanonicalizeCalendar(calendar));
  const resolvedOptions = Q(GetOptionsObject(options));
  Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const isoDate = X(CreateISODateRecord(result.Year!, result.Month, result.Day));
  return Q(yield* CreateTemporalDate(isoDate, calendarType));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-comparesurpasses */
export function CompareSurpasses(sign: 1n | -1n, year: Integer, monthOrMonthCode: bigint | string, day: Integer, target: CalendarDateRecord): boolean {
  if (year !== target.Year) {
    if (sign * (year - target.Year) > 0) {
      return true;
    }
  } else if (typeof monthOrMonthCode === 'string' && monthOrMonthCode !== target.MonthCode) {
    // If sign = 1 and monthOrMonthCode is lexicographically ordered after target.[[MonthCode]], return true.
    if (sign === 1n && monthOrMonthCode > target.MonthCode) return true;
    if (sign === -1n && target.MonthCode > monthOrMonthCode) return true;
  } else if (typeof monthOrMonthCode === 'bigint' && monthOrMonthCode !== target.Month) {
    if (sign * (monthOrMonthCode - target.Month) > 0) {
      return true;
    }
  } else if (day !== target.Day) {
    if (sign * (day - target.Day) > 0) {
      return true;
    }
  }
  return false;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isodatesurpasses */
export function ISODateSurpasses(sign: 1n | -1n, baseDate: ISODateRecord, years: Integer, month: Integer, weeks: Integer, days: Integer, isoDateTo: ISODateRecord): boolean {
  const parts = CalendarISOToDate('iso8601', baseDate);
  const target = CalendarISOToDate('iso8601', isoDateTo);
  const y0 = parts.Year + years;
  if (CompareSurpasses(sign, y0, parts.MonthCode, parts.Day, target)) {
    return true;
  }
  if (month === 0n && weeks === 0n && days === 0n) {
    return false;
  }
  const m0 = parts.Month + month;
  const monthsAdded = BalanceISOYearMonth(y0, m0);
  if (CompareSurpasses(sign, monthsAdded.Year, monthsAdded.Month, parts.Day, target)) {
    return true;
  }
  if (weeks === 0n && days === 0n) {
    return false;
  }
  const regulatedDate = X(RegulateISODate(monthsAdded.Year, monthsAdded.Month, parts.Day, 'constrain'));
  const daysInWeek = 7n;
  const balancedDate = AddDaysToISODate(regulatedDate, daysInWeek * weeks + days);
  return CompareSurpasses(sign, balancedDate.Year, balancedDate.Month, balancedDate.Day, target);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-regulateisodate */
export function RegulateISODate(year: Integer, month: Integer, day: Integer, overflow: 'constrain' | 'reject'): PlainCompletion<ISODateRecord> {
  if (overflow === 'constrain') {
    month = max(1n, min(12n, month));
    const daysInMonth = ISODaysInMonth(year, month);
    day = max(1n, min(daysInMonth, day));
    return X(CreateISODateRecord(year, month, day));
  }
  Assert(overflow === 'reject');
  return Q(CreateISODateRecord(year, month, day));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isvalidisodate */
export function IsValidISODate(year: Integer, month: Integer, day: Integer): boolean {
  if (month < 1n || month > 12n) {
    return false;
  }
  const daysInMonth = ISODaysInMonth(year, month);
  if (day < 1n || day > daysInMonth) {
    return false;
  }
  return true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adddaystoisodate */
export function AddDaysToISODate(isoDate: ISODateRecord, days: Integer): ISODateRecord {
  const epochDays = ISODateToEpochDays(isoDate.Year, isoDate.Month - 1n, isoDate.Day) + days;
  const epochMilliseconds = EpochDaysToEpochMilliseconds(epochDays, 0n);
  return X(CreateISODateRecord(YearFromTime(Number(epochMilliseconds) as FiniteTimeValue), MonthFromTime(Number(epochMilliseconds) as FiniteTimeValue) + 1n, DateFromTime(Number(epochMilliseconds) as FiniteTimeValue)));
}

/** https://tc39.es/proposal-temporal/#sec-padisoyear */
export function PadISOYear(isoYear: Integer): string {
  if (isoYear >= 0n && isoYear <= 9999n) {
    return ToZeroPaddedDecimalString(isoYear, 4n);
  }
  let yearSign;
  if (isoYear > 0n) yearSign = '+';
  else yearSign = '-';
  const digitsString = ToZeroPaddedDecimalString(abs(isoYear), 6n);
  return yearSign + digitsString;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-temporaldatetostring */
export function TemporalDateToString(temporalDate: TemporalPlainDateObject, showCalendar: 'auto' | 'always' | 'never' | 'critical'): string {
  const year = PadISOYear(temporalDate.ISODate.Year);
  const month = ToZeroPaddedDecimalString(temporalDate.ISODate.Month, 2n);
  const day = ToZeroPaddedDecimalString(temporalDate.ISODate.Day, 2n);
  const calendar = FormatCalendarAnnotation(temporalDate.Calendar, showCalendar);
  return `${year}-${month}-${day}${calendar}`;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isodatewithinlimits */
export function ISODateWithinLimits(isoDate: ISODateRecord): boolean {
  const isoDateTime: ISODateTimeRecord = { ISODate: isoDate, Time: NoonTimeRecord() };
  return ISODateTimeWithinLimits(isoDateTime);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-compareisodate */
export function CompareISODate(xISODate: ISODateRecord, yISODate: ISODateRecord): 1n | -1n | 0n {
  if (xISODate.Year > yISODate.Year) return 1n;
  if (xISODate.Year < yISODate.Year) return -1n;
  if (xISODate.Month > yISODate.Month) return 1n;
  if (xISODate.Month < yISODate.Month) return -1n;
  if (xISODate.Day > yISODate.Day) return 1n;
  if (xISODate.Day < yISODate.Day) return -1n;
  return 0n;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencetemporalplaindate */
export function* DifferenceTemporalPlainDate(operation: 'since' | 'until', temporalDate: TemporalPlainDateObject, _other: Value, options: Value): ValueEvaluator<TemporalDurationObject> {
  const other = Q(yield* ToTemporalDate(_other));
  if (temporalDate.Calendar !== other.Calendar) {
    return Throw.RangeError('Calendars are not equal');
  }
  const resolvedOptions = Q(GetOptionsObject(options));
  const settings = Q(yield* GetDifferenceSettings(operation, resolvedOptions, 'date', [], 'day', 'day'));
  if (CompareISODate(temporalDate.ISODate, other.ISODate) === 0n) {
    return X(CreateTemporalDuration(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n));
  }
  const dateDifference = CalendarDateUntil(temporalDate.Calendar, temporalDate.ISODate, other.ISODate, settings.LargestUnit as DateUnit);
  let duration = CombineDateAndTimeDuration(dateDifference, 0n);
  if (settings.SmallestUnit !== 'day' || settings.RoundingIncrement !== 1n) {
    const isoDateTime: ISODateTimeRecord = { ISODate: temporalDate.ISODate, Time: MidnightTimeRecord() };
    const originEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTime);
    const isoDateTimeOther: ISODateTimeRecord = { ISODate: other.ISODate, Time: MidnightTimeRecord() };
    const destEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTimeOther);
    duration = Q(RoundRelativeDuration(duration, originEpochNanoseconds, destEpochNanoseconds, isoDateTime, NoTimeZone, temporalDate.Calendar, settings.LargestUnit, settings.RoundingIncrement, settings.SmallestUnit, settings.RoundingMode));
  }
  let result = X(TemporalDurationFromInternal(duration, 'day'));
  if (operation === 'since') {
    result = CreateNegatedTemporalDuration(result);
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adddurationtodate */
export function* AddDurationToDate(operation: 'add' | 'subtract', temporalDate: TemporalPlainDateObject, temporalDurationLike: Value, options: Value): ValueEvaluator<TemporalPlainDateObject> {
  const calendar = temporalDate.Calendar;
  let duration = Q(yield* ToTemporalDuration(temporalDurationLike));
  if (operation === 'subtract') duration = CreateNegatedTemporalDuration(duration);
  const internalDuration = ToInternalDurationRecordWith24HourDays(duration);
  const days = truncateDiv(internalDuration.Time, NanosecondsPerDay);
  const dateDuration = X(CreateDateDurationRecord(BigInt(internalDuration.Date.Years), BigInt(internalDuration.Date.Months), BigInt(internalDuration.Date.Weeks), days));
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const result = Q(CalendarDateAdd(calendar, temporalDate.ISODate, dateDuration, overflow));
  return X(CreateTemporalDate(result, calendar));
}

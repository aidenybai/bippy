import type { TemporalDurationObject } from '../../intrinsics/Temporal/Duration.mts';
import type { ISODateRecord } from '../../intrinsics/Temporal/PlainDate.mts';
import type { ISODateTimeRecord } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { type TemporalPlainYearMonthObject, isTemporalPlainYearMonthObject, type ISOYearMonthRecord } from '../../intrinsics/Temporal/PlainYearMonth.mts';
import { ParseISODateTime } from '../../parser/TemporalParser.mts';
import { floorDiv, modulo } from '../math.mts';
import { GetUTCEpochNanoseconds } from '../date-objects.mts';
import { NoTimeZone, ToZeroPaddedDecimalString } from './addition.mts';
import {
  Value, type ValueEvaluator, ObjectValue, Q, GetTemporalOverflowOption, X, GetTemporalCalendarIdentifierWithISODefault, PrepareCalendarFields, CalendarYearMonthFromFields, JSStringValue, Throw, CanonicalizeCalendar, CreateISODateRecord, ISODateToFields, type KnownCalendarType, type FunctionObject, surroundingAgent, OrdinaryCreateFromConstructor, type Mutable, PadISOYear, FormatCalendarAnnotation, GetDifferenceSettings, CompareISODate, CreateTemporalDuration, CalendarDateFromFields, CalendarDateUntil, type DateUnit, AdjustDateDurationRecord, CombineDateAndTimeDuration, RoundRelativeDuration, TemporalDurationFromInternal, CreateNegatedTemporalDuration, ToTemporalDuration, ToInternalDurationRecord, CalendarDateAdd,
  MidnightTimeRecord,
  type Integer,
  GetOptionsObject,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporalyearmonth */
export function* ToTemporalYearMonth(
  item: Value,
  options: Value = Value.undefined,
): ValueEvaluator<TemporalPlainYearMonthObject> {
  if (item instanceof ObjectValue) {
    if (isTemporalPlainYearMonthObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalYearMonth(item.ISODate, item.Calendar));
    }
    const calendar = Q(yield* GetTemporalCalendarIdentifierWithISODefault(item));
    const fields = Q(yield* PrepareCalendarFields(calendar, item, 'year-month-fields', 'no-non-calendar-fields', 'no-required-fields'));
    const resolvedOptions = Q(GetOptionsObject(options));
    const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
    const isoDate = Q(yield* CalendarYearMonthFromFields(calendar, fields, overflow));
    return X(CreateTemporalYearMonth(isoDate, calendar));
  }
  if (!(item instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', item);
  }
  const result = Q(ParseISODateTime(item.stringValue(), 'year-month'));
  const calendar = result.Calendar ?? 'iso8601';
  const calendarType = Q(CanonicalizeCalendar(calendar));
  const resolvedOptions = Q(GetOptionsObject(options));
  Q(yield* GetTemporalOverflowOption(resolvedOptions));
  let isoDate = X(CreateISODateRecord(result.Year!, result.Month, result.Day));
  if (!ISOYearMonthWithinLimits(isoDate)) {
    return Throw.RangeError('PlainYearMonth out of range');
  }
  const result2 = ISODateToFields(calendarType, isoDate, 'year-month');
  isoDate = Q(yield* CalendarYearMonthFromFields(calendarType, result2, 'constrain'));
  return X(CreateTemporalYearMonth(isoDate, calendarType));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isoyearmonthwithinlimits */
export function ISOYearMonthWithinLimits(
  isoDate: ISODateRecord,
): boolean {
  if (isoDate.Year < -271821 || isoDate.Year > 275760) return false;
  if (isoDate.Year === -271821n && isoDate.Month < 4) return false;
  if (isoDate.Year === 275760n && isoDate.Month > 9) return false;
  return true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-balanceisoyearmonth */
export function BalanceISOYearMonth(
  year: Integer,
  month: Integer,
): ISOYearMonthRecord {
  year += floorDiv((month - 1n), 12n);
  month = modulo(month - 1n, 12n) + 1n;
  return {
    Year: year,
    Month: month,
  };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtemporalyearmonth */
export function* CreateTemporalYearMonth(
  isoDate: ISODateRecord,
  calendar: KnownCalendarType,
  newTarget?: FunctionObject,
): ValueEvaluator<TemporalPlainYearMonthObject> {
  if (!ISOYearMonthWithinLimits(isoDate)) {
    return Throw.RangeError('PlainYearMonth out of range');
  }
  if (newTarget === undefined) {
    newTarget = surroundingAgent.intrinsic('%Temporal.PlainYearMonth%');
  }
  const object = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%Temporal.PlainYearMonth.prototype%', [
    'InitializedTemporalYearMonth',
    'ISODate',
    'Calendar',
  ])) as Mutable<TemporalPlainYearMonthObject>;
  object.ISODate = isoDate;
  object.Calendar = calendar;
  return object;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-temporalyearmonthtostring */
export function TemporalYearMonthToString(
  yearMonth: TemporalPlainYearMonthObject,
  showCalendar: 'auto' | 'always' | 'never' | 'critical',
): string {
  const year = PadISOYear(yearMonth.ISODate.Year);
  const month = ToZeroPaddedDecimalString(yearMonth.ISODate.Month, 2n);
  let result = `${year}-${month}`;
  if (showCalendar === 'always' || showCalendar === 'critical' || yearMonth.Calendar !== 'iso8601') {
    const day = ToZeroPaddedDecimalString(yearMonth.ISODate.Day, 2n);
    result = `${result}-${day}`;
  }
  const calendarString = FormatCalendarAnnotation(yearMonth.Calendar, showCalendar);
  return result + calendarString;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencetemporalplainyearmonth */
export function* DifferenceTemporalPlainYearMonth(
  operation: 'since' | 'until',
  yearMonth: TemporalPlainYearMonthObject,
  _other: Value,
  options: Value,
): ValueEvaluator<TemporalDurationObject> {
  const other = Q(yield* ToTemporalYearMonth(_other));
  const calendar = yearMonth.Calendar;
  if (calendar !== other.Calendar) {
    return Throw.RangeError('PlainYearMonth calendars do not match');
  }
  const resolvedOptions = Q(GetOptionsObject(options));
  const settings = Q(yield* GetDifferenceSettings(
    operation,
    resolvedOptions,
    'date',
    ['week', 'day'],
    'month',
    'year',
  ));
  if (CompareISODate(yearMonth.ISODate, other.ISODate) === 0n) {
    return X(CreateTemporalDuration(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n));
  }
  const thisFields = ISODateToFields(calendar, yearMonth.ISODate, 'year-month');
  thisFields.Day = 1n;
  const thisDate = Q(yield* CalendarDateFromFields(calendar, thisFields, 'constrain'));
  const otherFields = ISODateToFields(calendar, other.ISODate, 'year-month');
  otherFields.Day = 1n;
  const otherDate = Q(yield* CalendarDateFromFields(calendar, otherFields, 'constrain'));
  const dateDifference = CalendarDateUntil(calendar, thisDate, otherDate, settings.LargestUnit as DateUnit);
  const yearsMonthsDifference = X(AdjustDateDurationRecord(dateDifference, 0n, 0n));
  let duration = CombineDateAndTimeDuration(yearsMonthsDifference, 0n);
  if (settings.SmallestUnit !== 'month' || settings.RoundingIncrement !== 1n) {
    const isoDateTime: ISODateTimeRecord = { ISODate: thisDate, Time: MidnightTimeRecord() };
    const originEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTime);
    const isoDateTimeOther: ISODateTimeRecord = { ISODate: otherDate, Time: MidnightTimeRecord() };
    const destEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTimeOther);
    duration = Q(RoundRelativeDuration(
      duration,
      originEpochNanoseconds,
      destEpochNanoseconds,
      isoDateTime,
      NoTimeZone,
      calendar,
      settings.LargestUnit,
      settings.RoundingIncrement,
      settings.SmallestUnit,
      settings.RoundingMode,
    ));
  }
  let result = X(TemporalDurationFromInternal(duration, 'day'));
  if (operation === 'since') {
    result = CreateNegatedTemporalDuration(result);
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adddurationtoyearmonth */
export function* AddDurationToYearMonth(
  operation: 'add' | 'subtract',
  yearMonth: TemporalPlainYearMonthObject,
  temporalDurationLike: Value,
  options: Value,
): ValueEvaluator<TemporalPlainYearMonthObject> {
  let duration = Q(yield* ToTemporalDuration(temporalDurationLike));
  if (operation === 'subtract') {
    duration = CreateNegatedTemporalDuration(duration);
  }
  const internalDuration = ToInternalDurationRecord(duration);
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const durationToAdd = internalDuration.Date;
  if (durationToAdd.Weeks !== 0 || durationToAdd.Days !== 0 || internalDuration.Time !== 0n) {
    return Throw.RangeError('Invalid duration');
  }
  const calendar = yearMonth.Calendar;
  const fields = ISODateToFields(calendar, yearMonth.ISODate, 'year-month');
  fields.Day = 1n;
  const date = Q(yield* CalendarDateFromFields(calendar, fields, 'constrain'));
  const addedDate = Q(CalendarDateAdd(calendar, date, durationToAdd, overflow));
  const addedDateFields = ISODateToFields(calendar, addedDate, 'year-month');
  const isoDate = Q(yield* CalendarYearMonthFromFields(calendar, addedDateFields, overflow));
  return X(CreateTemporalYearMonth(isoDate, calendar));
}

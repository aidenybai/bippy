import {
  __ts_cast__, OutOfRange, type Mutable,
} from '../../utils/language.mts';
import { ParseMonthCode, ParseTemporalCalendarString } from '../../parser/TemporalParser.mts';
import { ParseDateTimeUTCOffset } from '../date-objects.mts';
import { type ISODateRecord } from '../../intrinsics/Temporal/PlainDate.mts';
import { floorDiv } from '../math.mts';
import { SnapToInteger } from '../type-conversion.mts';
import { ToZeroPaddedDecimalString } from './addition.mts';
import type { YearWeekRecord } from './addition.mts';
import {
  EpochDaysToEpochMilliseconds,
  ISODateToEpochDays,
  type DateUnit,
} from './temporal.mts';
import { ToTemporalTimeZoneIdentifier } from './time-zone.mts';
import { mark_OtherCalendarNotImplemented, unreachable_OtherCalendarNotImplemented } from './not-implemented.mts';
import {
  AddDaysToISODate,
  Assert,
  BalanceISOYearMonth,
  CompareISODate,
  CreateDateDurationRecord,
  CreateISODateRecord,
  Get,
  InLeapYear,
  DayWithinYear,
  ISODateSurpasses,
  ISODateWithinLimits,
  ISOYearMonthWithinLimits,
  JSStringValue,
  ObjectValue,
  Q,
  RegulateISODate,
  Throw,
  TimeFromYear,
  WeekDay,
  ToPrimitive,
  ToString,
  Value,
  X,
  ZeroDateDuration,
  type DateDurationRecord,
  type FiniteTimeValue,
  type Integer,
  type IntegralNumber,
  type PlainCompletion, type PlainEvaluator,
  type TemporalPlainDateObject,
  type TemporalPlainDateTimeObject,
  type TemporalPlainMonthDayObject,
  type TemporalPlainYearMonthObject,
  type TemporalZonedDateTimeObject,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-known-calendar-types */
export type KnownCalendarType = 'iso8601';

/** https://tc39.es/proposal-temporal/#sec-temporal-canonicalizecalendar */
export function CanonicalizeCalendar(id: string): PlainCompletion<KnownCalendarType> {
  if (id.toLowerCase() !== 'iso8601') {
    return Throw.RangeError('$1 is not a supported calendar', id);
  }
  return 'iso8601';
}

/** https://tc39.es/proposal-temporal/#sec-temporal-availablecalendars */
export function AvailableCalendars(): KnownCalendarType[] {
  mark_OtherCalendarNotImplemented();
  return ['iso8601'];
}

export type MonthCode = string & { __brand: 'MonthCode' };

/** https://tc39.es/proposal-temporal/#sec-temporal-createmonthcode */
export function CreateMonthCode(monthNumber: Integer, isLeapMonth: boolean): MonthCode {
  if (!isLeapMonth) Assert(monthNumber > 0n);
  const numberPart = ToZeroPaddedDecimalString(monthNumber, 2n);
  if (isLeapMonth) {
    return `M${numberPart}L` as MonthCode;
  }
  return `M${numberPart}` as MonthCode;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendar-date-records */
export interface CalendarDateRecord {
  readonly Era: string | undefined;
  readonly EraYear: Integer | undefined;
  readonly Year: Integer;
  readonly Month: Integer;
  readonly MonthCode: string;
  readonly Day: Integer;
  readonly DayOfWeek: Integer;
  readonly DayOfYear: Integer;
  readonly WeekOfYear: YearWeekRecord;
  readonly DaysInWeek: Integer;
  readonly DaysInMonth: Integer;
  readonly DaysInYear: Integer;
  readonly MonthsInYear: Integer;
  readonly InLeapYear: boolean;
}

/** https://tc39.es/proposal-temporal/#table-temporal-calendar-fields-record-fields */
export interface CalendarFieldsRecord {
  readonly Era: string | undefined;
  readonly EraYear: Integer | undefined;
  Year: Integer | undefined;
  Month: Integer | undefined;
  MonthCode: string | undefined;
  Day: Integer | undefined;
  Hour: Integer | undefined;
  Minute: Integer | undefined;
  Second: Integer | undefined;
  Millisecond: Integer | undefined;
  Microsecond: Integer | undefined;
  Nanosecond: Integer | undefined;
  OffsetString: string | undefined;
  readonly TimeZone: string | undefined;
}

export type CalendarPropertyKey = 'era' | 'eraYear' | 'year' | 'month' | 'monthCode' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond' | 'microsecond' | 'nanosecond' | 'offset' | 'timeZone';
export type CalendarFields = 'date-fields' | 'year-month-fields' | 'only-day' | 'only-year';
export type NonCalendarFields = 'time-fields' | 'time-fields-with-offset' | 'time-fields-with-time-zone-and-offset' | 'no-non-calendar-fields';
export type RequiredCalendarFields = 'partial' | 'time-zone' | 'no-required-fields';

/** https://tc39.es/proposal-temporal/#sec-temporal-preparecalendarfields */
export function* PrepareCalendarFields(
  calendar: KnownCalendarType,
  fields: ObjectValue,
  calendarFields: CalendarFields,
  nonCalendarFields: NonCalendarFields,
  requiredFields: RequiredCalendarFields,
): PlainEvaluator<CalendarFieldsRecord> {
  let propertyNames: CalendarPropertyKey[];
  if (calendarFields === 'date-fields') propertyNames = ['day', 'month', 'monthCode', 'year'];
  else if (calendarFields === 'year-month-fields') propertyNames = ['month', 'monthCode', 'year'];
  else if (calendarFields === 'only-day') propertyNames = ['day'];
  else if (calendarFields === 'only-year') propertyNames = ['year'];
  else throw OutOfRange.exhaustive(calendarFields);
  const extraFieldNames = CalendarExtraFields(calendar, propertyNames);
  if (nonCalendarFields !== 'no-non-calendar-fields') {
    propertyNames = [...propertyNames, 'hour', 'microsecond', 'millisecond', 'minute', 'nanosecond', 'second'];
  }
  if (nonCalendarFields === 'time-fields-with-offset' || nonCalendarFields === 'time-fields-with-time-zone-and-offset') propertyNames.push('offset');
  if (nonCalendarFields === 'time-fields-with-time-zone-and-offset') propertyNames.push('timeZone');
  propertyNames = [...propertyNames, ...extraFieldNames];
  // Assert: fieldNames contains no duplicate elements.
  Assert(propertyNames.length === new Set(propertyNames).size);
  const result: Mutable<CalendarFieldsRecord> = {
    Era: undefined,
    EraYear: undefined,
    Year: undefined,
    Month: undefined,
    MonthCode: undefined,
    Day: undefined,
    Hour: undefined,
    Minute: undefined,
    Second: undefined,
    Millisecond: undefined,
    Microsecond: undefined,
    Nanosecond: undefined,
    OffsetString: undefined,
    TimeZone: undefined,
  };
  if (requiredFields !== 'partial') {
    result.Hour = 0n;
    result.Minute = 0n;
    result.Second = 0n;
    result.Millisecond = 0n;
    result.Microsecond = 0n;
    result.Nanosecond = 0n;
  }
  let anyPresent = false;

  // Sort _propertyNames_ according to lexicographic code unit order.
  propertyNames.sort();

  for (const property of propertyNames) {
    let value = Q(yield* Get(fields, Value(property)));
    if (value === Value.undefined) {
      if (requiredFields === 'time-zone' && property === 'timeZone') {
        return Throw.TypeError('time-zone is required');
      }
    } else {
      anyPresent = true;
      if (property === 'era') result.Era = Q(yield* ToString(value));
      else if (property === 'eraYear') result.EraYear = Q(yield* SnapToInteger(value, 'truncate'));
      else if (property === 'year') result.Year = Q(yield* SnapToInteger(value, 'truncate'));
      else if (property === 'month') result.Month = Q(yield* SnapToInteger(value, 'truncate', 1n));
      else if (property === 'monthCode') {
        const parsed = Q(yield* ParseMonthCode(value));
        result.MonthCode = CreateMonthCode(parsed.MonthNumber, parsed.IsLeapMonth);
      } else if (property === 'day') result.Day = Q(yield* SnapToInteger(value, 'truncate', 1n));
      else if (property === 'hour') result.Hour = Q(yield* SnapToInteger(value, 'truncate'));
      else if (property === 'minute') result.Minute = Q(yield* SnapToInteger(value, 'truncate'));
      else if (property === 'second') result.Second = Q(yield* SnapToInteger(value, 'truncate'));
      else if (property === 'millisecond') result.Millisecond = Q(yield* SnapToInteger(value, 'truncate'));
      else if (property === 'microsecond') result.Microsecond = Q(yield* SnapToInteger(value, 'truncate'));
      else if (property === 'nanosecond') result.Nanosecond = Q(yield* SnapToInteger(value, 'truncate'));
      else if (property === 'timeZone') result.TimeZone = Q(ToTemporalTimeZoneIdentifier(value));
      else if (property === 'offset') {
        value = Q(yield* ToPrimitive(value, 'string'));
        if (!(value instanceof JSStringValue)) {
          return Throw.TypeError('offset is not a string');
        }
        Q(ParseDateTimeUTCOffset(value.stringValue()));
        result.OffsetString = value.stringValue();
      } else throw OutOfRange.exhaustive(property);
    }
  }

  if (requiredFields === 'partial' && !anyPresent) {
    return Throw.TypeError('$1 is not a TemporalTimeLike object', fields);
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendarmergefields */
export function CalendarMergeFields(calendar: KnownCalendarType, fields: CalendarFieldsRecord, additionalFields: CalendarFieldsRecord): CalendarFieldsRecord {
  const overriddenKeys = CalendarFieldKeysToIgnore(calendar, additionalFields);
  const merged: Mutable<CalendarFieldsRecord> = {
    Era: undefined,
    EraYear: undefined,
    Year: undefined,
    Month: undefined,
    MonthCode: undefined,
    Day: undefined,
    Hour: undefined,
    Minute: undefined,
    Second: undefined,
    Millisecond: undefined,
    Microsecond: undefined,
    Nanosecond: undefined,
    OffsetString: undefined,
    TimeZone: undefined,
  };
  if (fields.Era !== undefined && !overriddenKeys.includes('era')) merged.Era = fields.Era;
  if (additionalFields.Era !== undefined) merged.Era = additionalFields.Era;

  if (fields.EraYear !== undefined && !overriddenKeys.includes('eraYear')) merged.EraYear = fields.EraYear;
  if (additionalFields.EraYear !== undefined) merged.EraYear = additionalFields.EraYear;

  if (fields.Year !== undefined && !overriddenKeys.includes('year')) merged.Year = fields.Year;
  if (additionalFields.Year !== undefined) merged.Year = additionalFields.Year;

  if (fields.Month !== undefined && !overriddenKeys.includes('month')) merged.Month = fields.Month;
  if (additionalFields.Month !== undefined) merged.Month = additionalFields.Month;

  if (fields.MonthCode !== undefined && !overriddenKeys.includes('monthCode')) merged.MonthCode = fields.MonthCode;
  if (additionalFields.MonthCode !== undefined) merged.MonthCode = additionalFields.MonthCode;

  if (fields.Day !== undefined && !overriddenKeys.includes('day')) merged.Day = fields.Day;
  if (additionalFields.Day !== undefined) merged.Day = additionalFields.Day;

  if (fields.Hour !== undefined && !overriddenKeys.includes('hour')) merged.Hour = fields.Hour;
  if (additionalFields.Hour !== undefined) merged.Hour = additionalFields.Hour;

  if (fields.Minute !== undefined && !overriddenKeys.includes('minute')) merged.Minute = fields.Minute;
  if (additionalFields.Minute !== undefined) merged.Minute = additionalFields.Minute;

  if (fields.Second !== undefined && !overriddenKeys.includes('second')) merged.Second = fields.Second;
  if (additionalFields.Second !== undefined) merged.Second = additionalFields.Second;

  if (fields.Millisecond !== undefined && !overriddenKeys.includes('millisecond')) merged.Millisecond = fields.Millisecond;
  if (additionalFields.Millisecond !== undefined) merged.Millisecond = additionalFields.Millisecond;

  if (fields.Microsecond !== undefined && !overriddenKeys.includes('microsecond')) merged.Microsecond = fields.Microsecond;
  if (additionalFields.Microsecond !== undefined) merged.Microsecond = additionalFields.Microsecond;

  if (fields.Nanosecond !== undefined && !overriddenKeys.includes('nanosecond')) merged.Nanosecond = fields.Nanosecond;
  if (additionalFields.Nanosecond !== undefined) merged.Nanosecond = additionalFields.Nanosecond;

  if (fields.OffsetString !== undefined && !overriddenKeys.includes('offset')) merged.OffsetString = fields.OffsetString;
  if (additionalFields.OffsetString !== undefined) merged.OffsetString = additionalFields.OffsetString;

  if (fields.TimeZone !== undefined && !overriddenKeys.includes('timeZone')) merged.TimeZone = fields.TimeZone;
  if (additionalFields.TimeZone !== undefined) merged.TimeZone = additionalFields.TimeZone;
  return merged;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nonisodateadd */
export function NonISODateAdd(
  _calendar: Exclude<KnownCalendarType, 'iso8601'>,
  _isoDate: ISODateRecord,
  _duration: DateDurationRecord,
  _overflow: 'constrain' | 'reject',
): never {
  mark_OtherCalendarNotImplemented();
  unreachable_OtherCalendarNotImplemented();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendardateadd */
export function CalendarDateAdd(
  calendar: KnownCalendarType,
  isoDate: ISODateRecord,
  duration: DateDurationRecord,
  overflow: 'constrain' | 'reject',
): PlainCompletion<ISODateRecord> {
  let result: ISODateRecord;
  if (calendar === 'iso8601') {
    const intermediate = Q(BalanceISOYearMonth(isoDate.Year + BigInt(duration.Years), isoDate.Month + BigInt(duration.Months)));
    const regulated = Q(RegulateISODate(intermediate.Year, intermediate.Month, isoDate.Day, overflow));
    const days = BigInt(duration.Days) + 7n * BigInt(duration.Weeks);
    result = Q(AddDaysToISODate(regulated, days));
  } else {
    result = Q(NonISODateAdd(calendar, isoDate, duration, overflow));
  }
  if (!ISODateWithinLimits(result)) {
    return Throw.RangeError('Resulting ISODate is out of range');
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nonisodateuntil */
export function NonISODateUntil(
  _calendar: Exclude<KnownCalendarType, 'iso8601'>,
  _isoDateFrom: ISODateRecord,
  _isoDateTo: ISODateRecord,
  _largestUnit: DateUnit,
): never {
  mark_OtherCalendarNotImplemented();
  unreachable_OtherCalendarNotImplemented();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendardateuntil */
export function CalendarDateUntil(
  calendar: KnownCalendarType,
  isoDateFrom: ISODateRecord,
  isoDateTo: ISODateRecord,
  largestUnit: DateUnit,
): DateDurationRecord {
  let sign = CompareISODate(isoDateFrom, isoDateTo);
  if (sign === 0n) return ZeroDateDuration();
  if (calendar === 'iso8601') {
    sign = -sign as 1n | -1n;
    let years = 0n;
    if (largestUnit === 'year') {
      let candidateYears = sign;
      while (!ISODateSurpasses(sign, isoDateFrom, candidateYears, 0n, 0n, 0n, isoDateTo)) {
        years = candidateYears;
        candidateYears += sign;
      }
    }
    let months = 0n;
    if (largestUnit === 'year' || largestUnit === 'month') {
      let candidateMonths = sign;
      while (!ISODateSurpasses(sign, isoDateFrom, years, candidateMonths, 0n, 0n, isoDateTo)) {
        months = candidateMonths;
        candidateMonths += sign;
      }
    }
    let weeks = 0n;
    if (largestUnit === 'week') {
      let candidateWeeks = sign;
      while (!ISODateSurpasses(sign, isoDateFrom, years, months, candidateWeeks, 0n, isoDateTo)) {
        weeks = candidateWeeks;
        candidateWeeks += sign;
      }
    }
    let days = 0n;
    let candidateDays = sign;
    while (!ISODateSurpasses(sign, isoDateFrom, years, months, weeks, candidateDays, isoDateTo)) {
      days = candidateDays;
      candidateDays += sign;
    }
    return X(CreateDateDurationRecord(years, months, weeks, days));
  }
  return NonISODateUntil(calendar, isoDateFrom, isoDateTo, largestUnit);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporalcalendaridentifier */
export function ToTemporalCalendarIdentifier(temporalCalendarLike: Value): PlainCompletion<KnownCalendarType> {
  if (temporalCalendarLike instanceof ObjectValue) {
    if ('Calendar' in temporalCalendarLike) {
      return (temporalCalendarLike as TemporalPlainDateObject | TemporalPlainDateTimeObject | TemporalPlainMonthDayObject | TemporalPlainYearMonthObject | TemporalZonedDateTimeObject).Calendar;
    }
  }
  if (!(temporalCalendarLike instanceof JSStringValue)) {
    return Throw.TypeError('temporalCalendarLike must be a string or a Temporal object, but got $1', temporalCalendarLike);
  }
  const identifier = Q(ParseTemporalCalendarString(temporalCalendarLike.stringValue()));
  return Q(CanonicalizeCalendar(identifier));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-gettemporalcalendaridentifierwithisodefault */
export function* GetTemporalCalendarIdentifierWithISODefault(temporalObjectLike: ObjectValue): PlainEvaluator<KnownCalendarType> {
  if ('Calendar' in temporalObjectLike) {
    return (temporalObjectLike as TemporalPlainDateObject | TemporalPlainDateTimeObject | TemporalPlainMonthDayObject | TemporalPlainYearMonthObject | TemporalZonedDateTimeObject).Calendar;
  }
  const calendarLike = Q(yield* Get(temporalObjectLike, 'calendar'));
  if (calendarLike === Value.undefined) {
    return 'iso8601';
  }
  return Q(ToTemporalCalendarIdentifier(calendarLike));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendardatefromfields */
export function* CalendarDateFromFields(
  calendar: KnownCalendarType,
  fields: CalendarFieldsRecord,
  overflow: 'constrain' | 'reject',
): PlainEvaluator<ISODateRecord> {
  Q(yield* CalendarResolveFields(calendar, fields, 'date'));
  const result = Q(CalendarDateToISO(calendar, fields, overflow));
  if (!ISODateWithinLimits(result)) {
    return Throw.RangeError('Resulting ISODate is out of range');
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendaryearmonthfromfields */
export function* CalendarYearMonthFromFields(
  calendar: KnownCalendarType,
  fields: CalendarFieldsRecord,
  overflow: 'constrain' | 'reject',
): PlainEvaluator<ISODateRecord> {
  Q(yield* CalendarResolveFields(calendar, fields, 'year-month'));
  // Let firstDayIndex be the 1-based index of the first day of the month described by fields (i.e., 1 unless the month's first day is skipped by this calendar.)
  const firstDayIndex = 1n;
  fields.Day = firstDayIndex;
  const result = Q(CalendarDateToISO(calendar, fields, overflow));
  if (!ISOYearMonthWithinLimits(result)) {
    return Throw.RangeError('Resulting ISODate is out of range');
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendarmonthdayfromfields */
export function* CalendarMonthDayFromFields(
  calendar: KnownCalendarType,
  fields: CalendarFieldsRecord,
  overflow: 'constrain' | 'reject',
): PlainEvaluator<ISODateRecord> {
  Q(yield* CalendarResolveFields(calendar, fields, 'month-day'));
  const result = Q(CalendarMonthDayToISOReferenceDate(calendar, fields, overflow));
  if (!ISODateWithinLimits(result)) {
    return Throw.RangeError('Resulting ISODate is out of range');
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-formatcalendarannotation */
export function FormatCalendarAnnotation(
  id: KnownCalendarType,
  showCalendar: 'auto' | 'always' | 'never' | 'critical',
): string {
  if (showCalendar === 'never') return '';
  if (showCalendar === 'auto' && id === 'iso8601') return '';
  const flag = showCalendar === 'critical' ? '!' : '';
  return `[${flag}u-ca=${id}]`;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isodaysinmonth */
export function ISODaysInMonth(year: Integer, month: Integer): Integer {
  if (month === 1n || month === 3n || month === 5n || month === 7n || month === 8n || month === 10n || month === 12n) {
    return 31n;
  }
  if (month === 4n || month === 6n || month === 9n || month === 11n) {
    return 30n;
  }
  Assert(month === 2n);
  return (28n + InLeapYear(TimeFromYear(year) as FiniteTimeValue));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isoweekofyear */
export function ISOWeekOfYear(isoDate: ISODateRecord): YearWeekRecord {
  const year = isoDate.Year;
  const wednesday = 3n;
  const thursday = 4n;
  const friday = 5n;
  const saturday = 6n;
  const daysInWeek = 7n;
  const maxWeekNumber = 53n;
  const dayOfYear = ISODayOfYear(isoDate);
  const dayOfWeek = ISODayOfWeek(isoDate);
  const week = floorDiv((dayOfYear + daysInWeek - dayOfWeek + wednesday), daysInWeek);
  if (week < 1) {
    // NOTE: This is the last week of the previous year.
    const jan1st = X(CreateISODateRecord(year, 1n, 1n));
    const dayOfJan1st = ISODayOfWeek(jan1st);
    if (dayOfJan1st === friday) {
      return { Week: maxWeekNumber, Year: year - 1n };
    }
    if (dayOfJan1st === saturday && InLeapYear(TimeFromYear(year - 1n) as FiniteTimeValue) === 1n) {
      return { Week: maxWeekNumber, Year: year - 1n };
    }
    return { Week: maxWeekNumber - 1n, Year: year - 1n };
  }
  if (week === maxWeekNumber) {
    let daysInYear;
    if (InLeapYear(TimeFromYear(year) as FiniteTimeValue) === 0n) {
      daysInYear = 365n;
    } else {
      daysInYear = 366n;
    }
    const daysLaterInYear = daysInYear - dayOfYear;
    const daysAfterThursday = thursday - dayOfWeek;
    if (daysLaterInYear < daysAfterThursday) {
      return { Week: 1n, Year: year + 1n };
    }
  }
  return { Week: week, Year: year };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isodayofyear */
export function ISODayOfYear(isoDate: ISODateRecord): Integer {
  const epochDays = ISODateToEpochDays(isoDate.Year, isoDate.Month - 1n, isoDate.Day);
  return DayWithinYear(Number(EpochDaysToEpochMilliseconds(epochDays, 0n)) as FiniteTimeValue) + 1n;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isodayofweek */
export function ISODayOfWeek(isoDate: ISODateRecord): Integer {
  const epochDays = ISODateToEpochDays(isoDate.Year, isoDate.Month - 1n, isoDate.Day);
  const dayOfWeek = WeekDay(Number(EpochDaysToEpochMilliseconds(epochDays, 0n)) as FiniteTimeValue);
  if (dayOfWeek === 0n) {
    return 7n;
  }
  return dayOfWeek;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nonisocalendardatetoiso */
export function NonISOCalendarDateToISO(
  _calendar: Exclude<KnownCalendarType, 'iso8601'>,
  _fields: CalendarFieldsRecord,
  _overflow: 'constrain' | 'reject',
): PlainCompletion<ISODateRecord> {
  mark_OtherCalendarNotImplemented();
  unreachable_OtherCalendarNotImplemented();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendardatetoiso */
export function CalendarDateToISO(
  calendar: KnownCalendarType,
  fields: CalendarFieldsRecord,
  overflow: 'constrain' | 'reject',
): PlainCompletion<ISODateRecord> {
  if (calendar === 'iso8601') {
    Assert(fields.Year !== undefined && fields.Month !== undefined && fields.Day !== undefined);
    return Q(RegulateISODate(fields.Year, fields.Month, fields.Day, overflow));
  }
  return Q(NonISOCalendarDateToISO(calendar, fields, overflow));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nonisomonthdaytoisoreferencedate */
export function NonISOMonthDayToISOReferenceDate(
  _calendar: Exclude<KnownCalendarType, 'iso8601'>,
  _fields: CalendarFieldsRecord,
  _overflow: 'constrain' | 'reject',
): never {
  mark_OtherCalendarNotImplemented();
  unreachable_OtherCalendarNotImplemented();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendarmonthdaytoisoreferencedate */
export function CalendarMonthDayToISOReferenceDate(
  calendar: KnownCalendarType,
  fields: CalendarFieldsRecord,
  overflow: 'constrain' | 'reject',
): PlainCompletion<ISODateRecord> {
  if (calendar === 'iso8601') {
    Assert(fields.Month !== undefined && fields.Day !== undefined);
    const referenceISOYear = 1972n;
    const year = fields.Year === undefined ? referenceISOYear : fields.Year;
    const result = Q(RegulateISODate(year, fields.Month, fields.Day, overflow));
    return X(CreateISODateRecord(referenceISOYear, result.Month, result.Day));
  }
  return Q(NonISOMonthDayToISOReferenceDate(calendar, fields, overflow));
}


// NonISOCalendarISOToDate
/** https://tc39.es/proposal-temporal/#sec-temporal-nonisocalendarisotodate */
export function NonISOCalendarISOToDate(
  _calendar: Exclude<KnownCalendarType, 'iso8601'>,
  _isoDate: ISODateRecord,
): CalendarDateRecord {
  mark_OtherCalendarNotImplemented();
  unreachable_OtherCalendarNotImplemented();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendarisotodate */
export function CalendarISOToDate(
  calendar: KnownCalendarType,
  isoDate: ISODateRecord,
): CalendarDateRecord {
  if (calendar === 'iso8601') {
    let daysInYear;
    let inLeapYear;
    if (InLeapYear(TimeFromYear(isoDate.Year) as IntegralNumber) === 1n) {
      daysInYear = 366n;
      inLeapYear = true;
    } else {
      daysInYear = 365n;
      inLeapYear = false;
    }
    return {
      Era: undefined,
      EraYear: undefined,
      Year: isoDate.Year,
      Month: isoDate.Month,
      MonthCode: CreateMonthCode(isoDate.Month, false),
      Day: isoDate.Day,
      DayOfWeek: ISODayOfWeek(isoDate),
      DayOfYear: ISODayOfYear(isoDate),
      WeekOfYear: ISOWeekOfYear(isoDate),
      DaysInWeek: 7n,
      DaysInMonth: ISODaysInMonth(isoDate.Year, isoDate.Month),
      DaysInYear: daysInYear,
      MonthsInYear: 12n,
      InLeapYear: inLeapYear,
    };
  }
  return NonISOCalendarISOToDate(calendar, isoDate);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendarextrafields */
export function CalendarExtraFields(
  calendar: KnownCalendarType,
  _fields: readonly CalendarPropertyKey[],
): CalendarPropertyKey[] {
  if (calendar === 'iso8601') {
    return [];
  }
  mark_OtherCalendarNotImplemented();
  unreachable_OtherCalendarNotImplemented();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nonisofieldkeystoignore */
export function NonISOFieldKeysToIgnore(
  _calendar: Exclude<KnownCalendarType, 'iso8601'>,
  _fields: CalendarFieldsRecord,
): CalendarPropertyKey[] {
  mark_OtherCalendarNotImplemented();
  unreachable_OtherCalendarNotImplemented();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendarfieldkeystoignore */
export function CalendarFieldKeysToIgnore(
  calendar: KnownCalendarType,
  fields: CalendarFieldsRecord,
): CalendarPropertyKey[] {
  if (calendar === 'iso8601') {
    const ignoredFields: Set<CalendarPropertyKey> = new Set();
    if (fields.Era !== undefined) ignoredFields.add('era');
    if (fields.EraYear !== undefined) ignoredFields.add('eraYear');
    if (fields.Year !== undefined) ignoredFields.add('year');
    if (fields.Month !== undefined || fields.MonthCode !== undefined) {
      ignoredFields.add('month');
      ignoredFields.add('monthCode');
    }
    if (fields.Day !== undefined) ignoredFields.add('day');
    if (fields.Hour !== undefined) ignoredFields.add('hour');
    if (fields.Minute !== undefined) ignoredFields.add('minute');
    if (fields.Second !== undefined) ignoredFields.add('second');
    if (fields.Millisecond !== undefined) ignoredFields.add('millisecond');
    if (fields.Microsecond !== undefined) ignoredFields.add('microsecond');
    if (fields.Nanosecond !== undefined) ignoredFields.add('nanosecond');
    return Array.from(ignoredFields);
  }
  return NonISOFieldKeysToIgnore(calendar, fields);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-nonisoresolvefields */
export function NonISOResolveFields(
  _calendar: Exclude<KnownCalendarType, 'iso8601'>,
  _fields: CalendarFieldsRecord,
  _type: 'date' | 'year-month' | 'month-day',
): CalendarFieldsRecord {
  mark_OtherCalendarNotImplemented();
  unreachable_OtherCalendarNotImplemented();
}

/** https://tc39.es/proposal-temporal/#sec-temporal-calendarresolvefields */
export function* CalendarResolveFields(
  calendar: KnownCalendarType,
  fields: CalendarFieldsRecord,
  type: 'date' | 'year-month' | 'month-day',
): PlainEvaluator<void> {
  if (calendar === 'iso8601') {
    let needsYear = false;
    if (type === 'date' || type === 'year-month') needsYear = true;
    let needsDay = false;
    if (type === 'date' || type === 'month-day') needsDay = true;

    if (needsYear && fields.Year === undefined) {
      return Throw.TypeError('"year" is required');
    }
    if (needsDay && fields.Day === undefined) {
      return Throw.TypeError('"day" is required');
    }
    if (fields.Month === undefined && fields.MonthCode === undefined) {
      return Throw.TypeError('"month-code" or "month" is required');
    }
    if (fields.MonthCode !== undefined) {
      const parsedMonthCode = X(ParseMonthCode(fields.MonthCode));
      if (parsedMonthCode.IsLeapMonth) return Throw.RangeError('Invalid leap month');
      const month = parsedMonthCode.MonthNumber;
      if (month > 12n) return Throw.RangeError('Invalid month');
      if (fields.Month !== undefined && fields.Month !== month) return Throw.RangeError('Mismatching month and month code');
      fields.Month = parsedMonthCode.MonthNumber;
    }
  } else {
    Q(NonISOResolveFields(calendar, fields, type));
  }
}

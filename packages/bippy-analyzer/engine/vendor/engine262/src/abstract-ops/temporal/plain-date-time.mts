import type { TemporalDurationObject } from '../../intrinsics/Temporal/Duration.mts';
import { isTemporalPlainDateObject } from '../../intrinsics/Temporal/PlainDate.mts';
import { type ISODateTimeRecord, type TemporalPlainDateTimeObject, isTemporalPlainDateTimeObject } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { isTemporalZonedDateTimeObject } from '../../intrinsics/Temporal/ZonedDateTime.mts';
import { ParseISODateTime } from '../../parser/TemporalParser.mts';
import { Decimal } from '../../host-defined/decimal.mts';
import { GetUTCEpochNanoseconds } from '../date-objects.mts';
import {
  NoTimeZone, ToZeroPaddedDecimalString, type RoundingMode,
} from './addition.mts';
import {
  CreateISODateRecord, YearFromTime, MonthFromTime, DateFromTime, CreateTimeRecord, HourFromTime, MinuteFromTime, SecondFromTime, MillisecondFromTime, ISODateToEpochDays, MinEpochNanoseconds, NanosecondsPerDay, MaxEpochNanoseconds, type KnownCalendarType, type CalendarFieldsRecord, type PlainEvaluator, Q, CalendarDateFromFields, RegulateTime, Value, ObjectValue, GetTemporalOverflowOption, X, GetISODateTimeFor, MidnightTimeRecord, GetTemporalCalendarIdentifierWithISODefault, PrepareCalendarFields, JSStringValue, Throw, CanonicalizeCalendar, BalanceTime, AddDaysToISODate, type FunctionObject, surroundingAgent, OrdinaryCreateFromConstructor, type Mutable, PadISOYear, FormatTimeString, FormatCalendarAnnotation, CompareISODate, CompareTimeRecord, type TimeUnit, type TemporalUnit, Assert, RoundTime, type InternalDurationRecord, DifferenceTime, TimeDurationSign, Add24HourDaysToTimeDuration, LargerOfTwoTemporalUnits, CalendarDateUntil, type DateUnit, CombineDateAndTimeDuration, type PlainCompletion, ZeroDateDuration, RoundRelativeDuration, TotalRelativeDuration, type ValueEvaluator, GetDifferenceSettings, CreateTemporalDuration, TemporalDurationFromInternal, CreateNegatedTemporalDuration, ToTemporalDuration, ToInternalDurationRecordWith24HourDays, AddTime, AdjustDateDurationRecord, CalendarDateAdd,
  type Integer,
  type FiniteTimeValue,
  type MathematicalValue,
  EpochDaysToEpochMilliseconds,
  GetOptionsObject,
  NanosecondsPerMillisecond,
  NanosecondsPerMicrosecond,
} from '#self';

/** https://tc39.es/proposal-temporal/#sec-temporal-timevaluetoisodatetimerecord */
export function TimeValueToISODateTimeRecord(tv: FiniteTimeValue): ISODateTimeRecord {
  const isoDate = X(CreateISODateRecord(YearFromTime(tv), MonthFromTime(tv) + 1n, DateFromTime(tv)));
  const time = X(CreateTimeRecord(HourFromTime(tv), MinuteFromTime(tv), SecondFromTime(tv), MillisecondFromTime(tv), 0n, 0n));
  return { ISODate: isoDate, Time: time };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-isodatetimewithinlimits */
export function ISODateTimeWithinLimits(isoDateTime: ISODateTimeRecord): boolean {
  const epochDays = ISODateToEpochDays(isoDateTime.ISODate.Year, isoDateTime.ISODate.Month - 1n, isoDateTime.ISODate.Day);
  if (epochDays < -100_000_001n || epochDays > 100_000_000n) {
    return false;
  }
  const epochNanoseconds = GetUTCEpochNanoseconds(isoDateTime);
  if (epochNanoseconds <= (MinEpochNanoseconds - NanosecondsPerDay)) return false;
  if (epochNanoseconds >= (MaxEpochNanoseconds + NanosecondsPerDay)) return false;
  return true;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-interprettemporaldatetimefields */
export function* InterpretTemporalDateTimeFields(calendar: KnownCalendarType, fields: CalendarFieldsRecord, overflow: 'constrain' | 'reject'): PlainEvaluator<ISODateTimeRecord> {
  Assert(fields.Hour !== undefined && fields.Minute !== undefined && fields.Second !== undefined && fields.Millisecond !== undefined && fields.Microsecond !== undefined && fields.Nanosecond !== undefined);
  const isoDate = Q(yield* CalendarDateFromFields(calendar, fields, overflow));
  const time = Q(RegulateTime(fields.Hour!, fields.Minute!, fields.Second!, fields.Millisecond!, fields.Microsecond!, fields.Nanosecond!, overflow));
  return { ISODate: isoDate, Time: time };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporaldatetime */
export function* ToTemporalDateTime(item: Value, options: Value = Value.undefined): PlainEvaluator<TemporalPlainDateTimeObject> {
  if (item instanceof ObjectValue) {
    if (isTemporalPlainDateTimeObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalDateTime(item.ISODateTime, item.Calendar));
    }
    if (isTemporalZonedDateTimeObject(item)) {
      const isoDateTime = GetISODateTimeFor(item.TimeZone, item.EpochNanoseconds);
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalDateTime(isoDateTime, item.Calendar));
    }
    if (isTemporalPlainDateObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      const isoDateTime: ISODateTimeRecord = { ISODate: item.ISODate, Time: MidnightTimeRecord() };
      return Q(yield* CreateTemporalDateTime(isoDateTime, item.Calendar));
    }
    const calendar = Q(yield* GetTemporalCalendarIdentifierWithISODefault(item));
    const fields = Q(yield* PrepareCalendarFields(calendar, item, 'date-fields', 'time-fields', 'no-required-fields'));
    const resolvedOptions = Q(GetOptionsObject(options));
    const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
    const fieldsResult = Q(yield* InterpretTemporalDateTimeFields(calendar, fields, overflow));
    return Q(yield* CreateTemporalDateTime(fieldsResult, calendar));
  }
  if (!(item instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', item);
  }
  const parseResult = Q(ParseISODateTime(item.stringValue(), 'plain-date-time'));
  const time = parseResult.Time === 'start-of-day' ? MidnightTimeRecord() : parseResult.Time;
  const calendar = parseResult.Calendar ?? 'iso8601';
  const calendarType = Q(CanonicalizeCalendar(calendar));
  const resolvedOptions = Q(GetOptionsObject(options));
  Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const isoDate = X(CreateISODateRecord(parseResult.Year!, parseResult.Month, parseResult.Day));
  const isoDateTime: ISODateTimeRecord = { ISODate: isoDate, Time: time };
  return Q(yield* CreateTemporalDateTime(isoDateTime, calendarType));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-balanceisodatetime */
export function BalanceISODateTime(year: Integer, month: Integer, day: Integer, hour: Integer, minute: Integer, second: Integer, millisecond: Integer, microsecond: Integer, nanosecond: Integer): ISODateTimeRecord {
  const balancedTime = BalanceTime(hour, minute, second, millisecond, microsecond, nanosecond);
  const epochDays = ISODateToEpochDays(year, month - 1n, day) + balancedTime.Days;
  const epochMilliseconds = EpochDaysToEpochMilliseconds(epochDays, 0n);
  const balancedDate = X(CreateISODateRecord(YearFromTime(Number(epochMilliseconds)), MonthFromTime(Number(epochMilliseconds)) + 1n, DateFromTime(Number(epochMilliseconds))));
  return { ISODate: balancedDate, Time: balancedTime };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtemporaldatetime */
export function* CreateTemporalDateTime(isoDateTime: ISODateTimeRecord, calendar: KnownCalendarType, newTarget?: FunctionObject): PlainEvaluator<TemporalPlainDateTimeObject> {
  if (!ISODateTimeWithinLimits(isoDateTime)) {
    return Throw.RangeError('PlainDateTime outside of range');
  }
  if (newTarget === undefined) {
    newTarget = surroundingAgent.intrinsic('%Temporal.PlainDateTime%');
  }
  const object = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%Temporal.PlainDateTime.prototype%', [
    'InitializedTemporalDateTime',
    'ISODateTime',
    'Calendar',
  ])) as Mutable<TemporalPlainDateTimeObject>;
  object.ISODateTime = isoDateTime;
  object.Calendar = calendar;
  return object;
}

/** https://tc39.es/proposal-temporal/#sec-formatisodatetime */
export function FormatISODateTime(isoDateTime: ISODateTimeRecord, calendar: KnownCalendarType, precision: Integer | 'minute' | 'auto', showCalendar: 'auto' | 'always' | 'never' | 'critical'): string {
  const yearString = PadISOYear(isoDateTime.ISODate.Year);
  const monthString = ToZeroPaddedDecimalString(isoDateTime.ISODate.Month, 2n);
  const dayString = ToZeroPaddedDecimalString(isoDateTime.ISODate.Day, 2n);
  const subSecondNanoseconds = isoDateTime.Time.Millisecond * NanosecondsPerMillisecond + isoDateTime.Time.Microsecond * NanosecondsPerMicrosecond + isoDateTime.Time.Nanosecond;
  const timeString = FormatTimeString(isoDateTime.Time.Hour, isoDateTime.Time.Minute, isoDateTime.Time.Second, subSecondNanoseconds, precision);
  const calendarString = FormatCalendarAnnotation(calendar, showCalendar);
  return `${yearString}-${monthString}-${dayString}T${timeString}${calendarString}`;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-compareisodatetime */
export function CompareISODateTime(xISODateTime: ISODateTimeRecord, yISODateTime: ISODateTimeRecord): 1n | -1n | 0n {
  const dateResult = CompareISODate(xISODateTime.ISODate, yISODateTime.ISODate);
  if (dateResult !== 0n) {
    return dateResult;
  }
  return CompareTimeRecord(xISODateTime.Time, yISODateTime.Time);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-roundisodatetime */
export function RoundISODateTime(isoDateTime: ISODateTimeRecord, increment: Integer, unit: TimeUnit | 'day', roundingMode: RoundingMode): ISODateTimeRecord {
  Assert(ISODateTimeWithinLimits(isoDateTime));
  const roundedTime = RoundTime(isoDateTime.Time, increment, unit, roundingMode);
  const balanceResult = AddDaysToISODate(isoDateTime.ISODate, roundedTime.Days);
  return { ISODate: balanceResult, Time: roundedTime };
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differenceisodatetime */
export function DifferenceISODateTime(xISODateTime: ISODateTimeRecord, yISODateTime: ISODateTimeRecord, calendar: KnownCalendarType, largestUnit: TemporalUnit): InternalDurationRecord {
  Assert(ISODateTimeWithinLimits(xISODateTime));
  Assert(ISODateTimeWithinLimits(yISODateTime));
  let timeDuration = DifferenceTime(xISODateTime.Time, yISODateTime.Time);
  const timeSign = TimeDurationSign(timeDuration);
  const dateSign = CompareISODate(xISODateTime.ISODate, yISODateTime.ISODate);
  let adjustedDate = yISODateTime.ISODate;
  if (timeSign === dateSign) {
    adjustedDate = AddDaysToISODate(adjustedDate, timeSign);
    timeDuration = X(Add24HourDaysToTimeDuration(timeDuration, -timeSign));
  }
  const dateLargestUnit = LargerOfTwoTemporalUnits('day', largestUnit);
  const dateDifference = CalendarDateUntil(calendar, xISODateTime.ISODate, adjustedDate, dateLargestUnit as DateUnit);
  if (largestUnit !== dateLargestUnit) {
    timeDuration = X(Add24HourDaysToTimeDuration(timeDuration, BigInt(dateDifference.Days)));
    dateDifference.Days = 0;
  }
  return CombineDateAndTimeDuration(dateDifference, timeDuration);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differenceplaindatetimewithrounding */
export function DifferencePlainDateTimeWithRounding(isoDateTimeFrom: ISODateTimeRecord, isoDateTimeTo: ISODateTimeRecord, calendar: KnownCalendarType, largestUnit: TemporalUnit, roundingIncrement: Integer, smallestUnit: TemporalUnit, roundingMode: RoundingMode): PlainCompletion<InternalDurationRecord> {
  if (CompareISODateTime(isoDateTimeFrom, isoDateTimeTo) === 0n) {
    return CombineDateAndTimeDuration(ZeroDateDuration(), 0n);
  }
  if (!ISODateTimeWithinLimits(isoDateTimeFrom) || !ISODateTimeWithinLimits(isoDateTimeTo)) {
    return Throw.RangeError('PlainDateTime outside of range');
  }
  const diff = DifferenceISODateTime(isoDateTimeFrom, isoDateTimeTo, calendar, largestUnit);
  if (smallestUnit === 'nanosecond' && roundingIncrement === 1n) {
    return diff;
  }
  const originEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTimeFrom);
  const destEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTimeTo);
  return RoundRelativeDuration(diff, originEpochNanoseconds, destEpochNanoseconds, isoDateTimeFrom, NoTimeZone, calendar, largestUnit, roundingIncrement, smallestUnit, roundingMode);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differenceplaindatetimewithtotal */
export function DifferencePlainDateTimeWithTotal(isoDateTimeFrom: ISODateTimeRecord, isoDateTimeTo: ISODateTimeRecord, calendar: KnownCalendarType, unit: TemporalUnit): PlainCompletion<MathematicalValue> {
  if (CompareISODateTime(isoDateTimeFrom, isoDateTimeTo) === 0n) {
    return Decimal(0);
  }
  if (!ISODateTimeWithinLimits(isoDateTimeFrom) || !ISODateTimeWithinLimits(isoDateTimeTo)) {
    return Throw.RangeError('PlainDateTime outside of range');
  }
  const diff = DifferenceISODateTime(isoDateTimeFrom, isoDateTimeTo, calendar, unit);
  if (unit === 'nanosecond') {
    return Decimal(diff.Time);
  }
  const originEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTimeFrom);
  const destEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTimeTo);
  return TotalRelativeDuration(diff, originEpochNanoseconds, destEpochNanoseconds, isoDateTimeFrom, NoTimeZone, calendar, unit);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencetemporalplaindatetime */
export function* DifferenceTemporalPlainDateTime(operation: 'since' | 'until', dateTime: TemporalPlainDateTimeObject, _other: Value, options: Value): ValueEvaluator<TemporalDurationObject> {
  const other = Q(yield* ToTemporalDateTime(_other));
  if (dateTime.Calendar !== other.Calendar) {
    return Throw.RangeError('Calendars are not equal');
  }
  const resolvedOptions = Q(GetOptionsObject(options));
  const settings = Q(yield* GetDifferenceSettings(operation, resolvedOptions, 'datetime', [], 'nanosecond', 'day'));
  if (CompareISODateTime(dateTime.ISODateTime, other.ISODateTime) === 0n) {
    return X(CreateTemporalDuration(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n));
  }
  const internalDuration = Q(DifferencePlainDateTimeWithRounding(dateTime.ISODateTime, other.ISODateTime, dateTime.Calendar, settings.LargestUnit, settings.RoundingIncrement, settings.SmallestUnit, settings.RoundingMode));
  let result = X(TemporalDurationFromInternal(internalDuration, settings.LargestUnit));
  if (operation === 'since') {
    result = CreateNegatedTemporalDuration(result);
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adddurationtodatetime */
export function* AddDurationToDateTime(operation: 'add' | 'subtract', dateTime: TemporalPlainDateTimeObject, temporalDurationLike: Value, options: Value): ValueEvaluator<TemporalPlainDateTimeObject> {
  let duration = Q(yield* ToTemporalDuration(temporalDurationLike));
  if (operation === 'subtract') {
    duration = CreateNegatedTemporalDuration(duration);
  }
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const internalDuration = ToInternalDurationRecordWith24HourDays(duration);
  const timeResult = AddTime(dateTime.ISODateTime.Time, internalDuration.Time);
  const dateDuration = Q(AdjustDateDurationRecord(internalDuration.Date, timeResult.Days));
  const addedDate = Q(CalendarDateAdd(dateTime.Calendar, dateTime.ISODateTime.ISODate, dateDuration, overflow));
  const result: ISODateTimeRecord = { ISODate: addedDate, Time: timeResult };
  return Q(yield* CreateTemporalDateTime(result, dateTime.Calendar));
}

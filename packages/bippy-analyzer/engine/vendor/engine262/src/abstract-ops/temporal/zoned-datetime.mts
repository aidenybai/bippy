import type { TemporalDurationObject } from '../../intrinsics/Temporal/Duration.mts';
import type { ISODateRecord } from '../../intrinsics/Temporal/PlainDate.mts';
import type { ISODateTimeRecord } from '../../intrinsics/Temporal/PlainDateTime.mts';
import { type TemporalZonedDateTimeObject, isTemporalZonedDateTimeObject } from '../../intrinsics/Temporal/ZonedDateTime.mts';
import { ParseISODateTime, DateParser } from '../../parser/TemporalParser.mts';
import { GetUTCEpochNanoseconds, ParseDateTimeUTCOffset } from '../date-objects.mts';
import { Decimal } from '../../host-defined/decimal.mts';
import {
  type TimeZoneIdentifier, type RoundingMode,
} from './addition.mts';
import {
  type PlainCompletion, Assert, Q, GetStartOfDay, GetEpochNanosecondsFor, ValidateISODaysRange, IsWithinEpochNanosecondsInterval, Throw, GetPossibleEpochNanoseconds, RoundNumberToIncrement, DisambiguatePossibleEpochNanoseconds, Value, type ValueEvaluator, type KnownCalendarType, ObjectValue, GetTemporalDisambiguationOption, GetTemporalOffsetOption, GetTemporalOverflowOption, X, GetTemporalCalendarIdentifierWithISODefault, PrepareCalendarFields, JSStringValue, ToTemporalTimeZoneIdentifier, CanonicalizeCalendar, CreateISODateRecord, type FunctionObject, surroundingAgent, OrdinaryCreateFromConstructor, type Mutable, RoundEpochNanoseconds, type TemporalUnit, GetOffsetNanosecondsFor, GetISODateTimeFor, FormatDateTimeUTCOffsetRounded, FormatCalendarAnnotation, type InternalDurationRecord, DateDurationSign, AddEpochNanoseconds, CalendarDateAdd, CombineDateAndTimeDuration, ZeroDateDuration, CompareISODate, TimeDurationFromEpochNanosecondsDifference, TimeDurationSign, AddDaysToISODate, LargerOfTwoTemporalUnits, CalendarDateUntil, type DateUnit, isTimeUnit, DifferenceEpochNanoseconds, type TimeUnit, RoundRelativeDuration, TotalTimeDuration, TotalRelativeDuration, GetDifferenceSettings, TemporalDurationFromInternal, CreateNegatedTemporalDuration, TimeZoneEquals, CreateTemporalDuration, ToTemporalDuration, ToInternalDurationRecord,
  BalanceISODateTime,
  DifferenceTime,
  InterpretTemporalDateTimeFields,
  FormatISODateTime,
  ISODateTimeWithinLimits,
  type TimeRecord,
  type Integer,
  type EpochNanoseconds,
  type MathematicalValue,
  GetOptionsObject,
  NanosecondsPerMinute,
} from '#self';

export type ISODateTimeOffsetBehaviour = 'option' | 'exact' | 'wall';
export type ISODateTimeMatchBehaviour = 'match-exactly' | 'match-minutes';

/** https://tc39.es/proposal-temporal/#sec-temporal-interpretisodatetimeoffset */
export function InterpretISODateTimeOffset(
  isoDate: ISODateRecord,
  time: TimeRecord | 'start-of-day',
  offsetBehaviour: ISODateTimeOffsetBehaviour,
  offsetNanoseconds: Integer,
  timeZone: TimeZoneIdentifier,
  disambiguation: 'earlier' | 'later' | 'compatible' | 'reject',
  offsetOption: 'ignore' | 'use' | 'prefer' | 'reject',
  matchBehaviour: ISODateTimeMatchBehaviour,
): PlainCompletion<EpochNanoseconds> {
  if (time === 'start-of-day') {
    Assert(offsetBehaviour === 'wall');
    Assert(offsetNanoseconds === 0n);
    return Q(GetStartOfDay(timeZone, isoDate));
  }
  const isoDateTime: ISODateTimeRecord = { ISODate: isoDate, Time: time };
  if (offsetBehaviour === 'wall' || (offsetBehaviour === 'option' && offsetOption === 'ignore')) {
    return Q(GetEpochNanosecondsFor(timeZone, isoDateTime, disambiguation));
  }
  if (offsetBehaviour === 'exact' || (offsetBehaviour === 'option' && offsetOption === 'use')) {
    const balanced = BalanceISODateTime(isoDate.Year, isoDate.Month, isoDate.Day, time.Hour, time.Minute, time.Second, time.Millisecond, time.Microsecond, time.Nanosecond - offsetNanoseconds);
    Q(ValidateISODaysRange(balanced.ISODate));
    const epochNanoseconds = GetUTCEpochNanoseconds(balanced);
    if (!IsWithinEpochNanosecondsInterval(epochNanoseconds)) {
      return Throw.RangeError('Invalid date');
    }
    return epochNanoseconds;
  }
  Assert(offsetBehaviour === 'option');
  Assert(offsetOption === 'prefer' || offsetOption === 'reject');
  Q(ValidateISODaysRange(isoDate));
  const utcEpochNanoseconds = GetUTCEpochNanoseconds(isoDateTime);
  const possibleEpochNanoseconds = Q(GetPossibleEpochNanoseconds(timeZone, isoDateTime));
  for (const candidate of possibleEpochNanoseconds) {
    const candidateOffset = utcEpochNanoseconds - candidate;
    if (candidateOffset === offsetNanoseconds) {
      return candidate;
    }
    if (matchBehaviour === 'match-minutes') {
      const roundedCandidateNanoseconds = RoundNumberToIncrement(Decimal(candidateOffset), NanosecondsPerMinute, 'halfExpand');
      if (roundedCandidateNanoseconds === offsetNanoseconds) {
        return candidate;
      }
    }
  }
  if (offsetOption === 'reject') {
    return Throw.RangeError('No matching offset found for the given date and time');
  }
  return Q(DisambiguatePossibleEpochNanoseconds(possibleEpochNanoseconds, timeZone, isoDateTime, disambiguation));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-totemporalzoneddatetime */
export function* ToTemporalZonedDateTime(
  item: Value,
  options: Value = Value.undefined,
): ValueEvaluator<TemporalZonedDateTimeObject> {
  let hasUTCDesignator = false;
  let matchBehaviour: ISODateTimeMatchBehaviour = 'match-exactly';
  let calendar: KnownCalendarType;
  let isoDate: ISODateRecord;
  let time: TimeRecord | 'start-of-day';
  let timeZone: TimeZoneIdentifier;
  let offsetString: string | undefined;
  let disambiguation: 'earlier' | 'later' | 'compatible' | 'reject';
  let offsetOption: 'ignore' | 'use' | 'prefer' | 'reject';
  if (item instanceof ObjectValue) {
    if (isTemporalZonedDateTimeObject(item)) {
      const resolvedOptions = Q(GetOptionsObject(options));
      Q(yield* GetTemporalDisambiguationOption(resolvedOptions));
      Q(yield* GetTemporalOffsetOption(resolvedOptions, 'reject'));
      Q(yield* GetTemporalOverflowOption(resolvedOptions));
      return X(CreateTemporalZonedDateTime(item.EpochNanoseconds, item.TimeZone, item.Calendar));
    }
    calendar = Q(yield* GetTemporalCalendarIdentifierWithISODefault(item));
    const fields = Q(yield* PrepareCalendarFields(calendar, item, 'date-fields', 'time-fields-with-time-zone-and-offset', 'time-zone'));
    timeZone = fields.TimeZone! as TimeZoneIdentifier;
    offsetString = fields.OffsetString;
    const resolvedOptions = Q(GetOptionsObject(options));
    disambiguation = Q(yield* GetTemporalDisambiguationOption(resolvedOptions));
    offsetOption = Q(yield* GetTemporalOffsetOption(resolvedOptions, 'reject'));
    const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
    const result = Q(yield* InterpretTemporalDateTimeFields(calendar, fields, overflow));
    isoDate = result.ISODate;
    time = result.Time;
  } else {
    if (!(item instanceof JSStringValue)) {
      return Throw.TypeError('$1 is not a string', item);
    }
    const result = Q(ParseISODateTime(item.stringValue(), 'zoned-date-time'));
    const annotation = result.TimeZone.TimeZoneAnnotation;
    Assert(annotation !== undefined);
    timeZone = Q(ToTemporalTimeZoneIdentifier(annotation));
    offsetString = result.TimeZone.OffsetString;
    if (result.TimeZone.Z) {
      hasUTCDesignator = true;
    }
    calendar = result.Calendar as KnownCalendarType ?? 'iso8601';
    calendar = Q(CanonicalizeCalendar(calendar));
    matchBehaviour = 'match-minutes';
    if (offsetString) {
      const offsetParseResult = DateParser.parse(offsetString, (parser) => parser.with({ SubMinutePrecision: true }, () => parser.parseUTCOffset()));
      Assert(offsetParseResult && !Array.isArray(offsetParseResult));
      if (offsetParseResult.Second !== undefined) {
        matchBehaviour = 'match-exactly';
      }
    }
    const resolvedOptions = Q(GetOptionsObject(options));
    disambiguation = Q(yield* GetTemporalDisambiguationOption(resolvedOptions));
    offsetOption = Q(yield* GetTemporalOffsetOption(resolvedOptions, 'reject'));
    Q(yield* GetTemporalOverflowOption(resolvedOptions));
    isoDate = X(CreateISODateRecord(result.Year!, result.Month, result.Day));
    time = result.Time;
  }
  let offsetBehaviour: ISODateTimeOffsetBehaviour;
  if (hasUTCDesignator) {
    offsetBehaviour = 'exact';
  } else if (offsetString === undefined) {
    offsetBehaviour = 'wall';
  } else {
    offsetBehaviour = 'option';
  }
  let offsetNanoseconds = 0n;
  if (offsetBehaviour === 'option') {
    offsetNanoseconds = X(ParseDateTimeUTCOffset(offsetString!));
  }
  const epochNanoseconds = Q(InterpretISODateTimeOffset(isoDate, time, offsetBehaviour, offsetNanoseconds, timeZone, disambiguation, offsetOption, matchBehaviour));
  return X(CreateTemporalZonedDateTime(epochNanoseconds, timeZone, calendar));
}

/** https://tc39.es/proposal-temporal/#sec-temporal-createtemporalzoneddatetime */
export function* CreateTemporalZonedDateTime(
  epochNanoseconds: EpochNanoseconds,
  timeZone: TimeZoneIdentifier,
  calendar: KnownCalendarType,
  newTarget?: FunctionObject,
): ValueEvaluator<TemporalZonedDateTimeObject> {
  Assert(IsWithinEpochNanosecondsInterval(epochNanoseconds));
  if (newTarget === undefined) {
    newTarget = surroundingAgent.intrinsic('%Temporal.ZonedDateTime%');
  }
  const object = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%Temporal.ZonedDateTime.prototype%', [
    'InitializedTemporalZonedDateTime',
    'EpochNanoseconds',
    'TimeZone',
    'Calendar',
  ])) as Mutable<TemporalZonedDateTimeObject>;
  object.EpochNanoseconds = epochNanoseconds;
  object.TimeZone = timeZone;
  object.Calendar = calendar;
  return object;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-temporalzoneddatetimetostring */
export function TemporalZonedDateTimeToString(
  zonedDateTime: TemporalZonedDateTimeObject,
  precision: Integer | 'minute' | 'auto',
  showCalendar: 'auto' | 'always' | 'never' | 'critical',
  showTimeZone: 'auto' | 'never' | 'critical',
  showOffset: 'auto' | 'never',
  increment: Integer = 1n,
  unit: Exclude<TimeUnit, 'hour'> = 'nanosecond',
  roundingMode: RoundingMode = 'trunc',
): string {
  let epochNanoseconds = zonedDateTime.EpochNanoseconds;
  epochNanoseconds = RoundEpochNanoseconds(epochNanoseconds, increment, unit, roundingMode);
  const timeZone = zonedDateTime.TimeZone;
  const offsetNanoseconds = GetOffsetNanosecondsFor(timeZone, epochNanoseconds);
  const isoDateTime = GetISODateTimeFor(timeZone, epochNanoseconds);
  const dateTimeString = FormatISODateTime(isoDateTime, 'iso8601', precision, 'never');
  const offsetString = showOffset === 'never' ? '' : FormatDateTimeUTCOffsetRounded(offsetNanoseconds);
  let timeZoneString;
  if (showTimeZone === 'never') {
    timeZoneString = '';
  } else {
    const flag = showTimeZone === 'critical' ? '!' : '';
    timeZoneString = `[${flag}${timeZone}]`;
  }
  const calendarString = FormatCalendarAnnotation(zonedDateTime.Calendar, showCalendar);
  return dateTimeString + offsetString + timeZoneString + calendarString;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-addzoneddatetime */
export function AddZonedDateTime(
  epochNanoseconds: EpochNanoseconds,
  timeZone: TimeZoneIdentifier,
  calendar: KnownCalendarType,
  duration: InternalDurationRecord,
  overflow: 'constrain' | 'reject',
): PlainCompletion<EpochNanoseconds> {
  if (DateDurationSign(duration.Date) === 0n) {
    return AddEpochNanoseconds(epochNanoseconds, duration.Time);
  }
  const isoDateTime = GetISODateTimeFor(timeZone, epochNanoseconds);
  const addedDate = Q(CalendarDateAdd(calendar, isoDateTime.ISODate, duration.Date, overflow));
  const intermediateDateTime: ISODateTimeRecord = { ISODate: addedDate, Time: isoDateTime.Time };
  if (!ISODateTimeWithinLimits(intermediateDateTime)) {
    return Throw.RangeError('Resulting date-time is out of range');
  }
  const intermediateNanoseconds = X(GetEpochNanosecondsFor(timeZone, intermediateDateTime, 'compatible'));
  return AddEpochNanoseconds(intermediateNanoseconds, duration.Time);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencezoneddatetime */
export function DifferenceZonedDateTime(
  epochNanosecondsFrom: EpochNanoseconds,
  epochNanosecondsTo: EpochNanoseconds,
  timeZone: TimeZoneIdentifier,
  calendar: KnownCalendarType,
  largestUnit: TemporalUnit,
): PlainCompletion<InternalDurationRecord> {
  if (epochNanosecondsFrom === epochNanosecondsTo) {
    return CombineDateAndTimeDuration(ZeroDateDuration(), 0n);
  }
  const startDateTime = GetISODateTimeFor(timeZone, epochNanosecondsFrom);
  const endDateTime = GetISODateTimeFor(timeZone, epochNanosecondsTo);
  if (CompareISODate(startDateTime.ISODate, endDateTime.ISODate) === 0n) {
    const timeDuration = TimeDurationFromEpochNanosecondsDifference(epochNanosecondsFrom, epochNanosecondsTo);
    return CombineDateAndTimeDuration(ZeroDateDuration(), timeDuration);
  }
  const sign = epochNanosecondsTo - epochNanosecondsFrom < 0n ? 1n : -1n;
  const maxDayCorrection = sign === -1n ? 2n : 1n;
  let dayCorrection = 0n;
  let timeDuration = DifferenceTime(startDateTime.Time, endDateTime.Time);
  if (TimeDurationSign(timeDuration) === sign) dayCorrection += 1n;
  let success = false;
  let intermediateDateTime: ISODateTimeRecord;
  while (dayCorrection <= maxDayCorrection && !success) {
    const intermediateDate = AddDaysToISODate(endDateTime.ISODate, dayCorrection * sign);
    intermediateDateTime = { ISODate: intermediateDate, Time: startDateTime.Time };
    const intermediateNanoseconds = Q(GetEpochNanosecondsFor(timeZone, intermediateDateTime, 'compatible'));
    timeDuration = TimeDurationFromEpochNanosecondsDifference(intermediateNanoseconds, epochNanosecondsTo);
    const timeSign = TimeDurationSign(timeDuration);
    if (sign !== timeSign) {
      success = true;
    }
    dayCorrection += 1n;
  }
  Assert(success);
  const dateLargestUnit = LargerOfTwoTemporalUnits(largestUnit, 'day');
  const dateDifference = CalendarDateUntil(calendar, startDateTime.ISODate, intermediateDateTime!.ISODate, dateLargestUnit as DateUnit);
  return CombineDateAndTimeDuration(dateDifference, timeDuration);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencezoneddatetimewithrounding */
export function DifferenceZonedDateTimeWithRounding(
  epochNanosecondsFrom: EpochNanoseconds,
  epochNanosecondsTo: EpochNanoseconds,
  timeZone: TimeZoneIdentifier,
  calendar: KnownCalendarType,
  largestUnit: TemporalUnit,
  roundingIncrement: Integer,
  smallestUnit: TemporalUnit,
  roundingMode: RoundingMode,
): PlainCompletion<InternalDurationRecord> {
  if (isTimeUnit(largestUnit)) {
    return DifferenceEpochNanoseconds(epochNanosecondsFrom, epochNanosecondsTo, roundingIncrement, smallestUnit as TimeUnit, roundingMode);
  }
  const difference = Q(DifferenceZonedDateTime(epochNanosecondsFrom, epochNanosecondsTo, timeZone, calendar, largestUnit));
  if (smallestUnit === 'nanosecond' && roundingIncrement === 1n) {
    return difference;
  }
  const dateTime = GetISODateTimeFor(timeZone, epochNanosecondsFrom);
  return RoundRelativeDuration(difference, epochNanosecondsFrom, epochNanosecondsTo, dateTime, timeZone, calendar, largestUnit, roundingIncrement, smallestUnit, roundingMode);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencezoneddatetimewithtotal */
export function DifferenceZonedDateTimeWithTotal(
  epochNanosecondsFrom: EpochNanoseconds,
  epochNanosecondsTo: EpochNanoseconds,
  timeZone: TimeZoneIdentifier,
  calendar: KnownCalendarType,
  unit: TemporalUnit,
): PlainCompletion<MathematicalValue> {
  if (isTimeUnit(unit)) {
    const difference = TimeDurationFromEpochNanosecondsDifference(epochNanosecondsFrom, epochNanosecondsTo);
    return TotalTimeDuration(difference, unit as TimeUnit);
  }
  const difference = Q(DifferenceZonedDateTime(epochNanosecondsFrom, epochNanosecondsTo, timeZone, calendar, unit));
  const dateTime = GetISODateTimeFor(timeZone, epochNanosecondsFrom);
  return TotalRelativeDuration(difference, epochNanosecondsFrom, epochNanosecondsTo, dateTime, timeZone, calendar, unit);
}

/** https://tc39.es/proposal-temporal/#sec-temporal-differencetemporalzoneddatetime */
export function* DifferenceTemporalZonedDateTime(
  operation: 'until' | 'since',
  zonedDateTime: TemporalZonedDateTimeObject,
  _other: Value,
  options: Value,
): ValueEvaluator<TemporalDurationObject> {
  const other = Q(yield* ToTemporalZonedDateTime(_other));
  if (zonedDateTime.Calendar !== other.Calendar) {
    return Throw.RangeError('Calendars are not equal');
  }
  const resolvedOptions = Q(GetOptionsObject(options));
  const settings = Q(yield* GetDifferenceSettings(operation, resolvedOptions, 'datetime', [], 'nanosecond', 'hour'));
  if (isTimeUnit(settings.LargestUnit)) {
    const internalDuration = DifferenceEpochNanoseconds(zonedDateTime.EpochNanoseconds, other.EpochNanoseconds, settings.RoundingIncrement, settings.SmallestUnit as TimeUnit, settings.RoundingMode);
    let result = X(TemporalDurationFromInternal(internalDuration, settings.LargestUnit));
    if (operation === 'since') {
      result = CreateNegatedTemporalDuration(result);
    }
    return result;
  }
  if (!TimeZoneEquals(zonedDateTime.TimeZone, other.TimeZone)) {
    return Throw.RangeError('Time zones are not equal');
  }
  if (zonedDateTime.EpochNanoseconds === other.EpochNanoseconds) {
    return X(CreateTemporalDuration(0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n));
  }
  const internalDuration = Q(DifferenceZonedDateTimeWithRounding(
    zonedDateTime.EpochNanoseconds,
    other.EpochNanoseconds,
    zonedDateTime.TimeZone,
    zonedDateTime.Calendar,
    settings.LargestUnit,
    settings.RoundingIncrement,
    settings.SmallestUnit,
    settings.RoundingMode,
  ));
  let result = X(TemporalDurationFromInternal(internalDuration, 'hour'));
  if (operation === 'since') {
    result = CreateNegatedTemporalDuration(result);
  }
  return result;
}

/** https://tc39.es/proposal-temporal/#sec-temporal-adddurationtozoneddatetime */
export function* AddDurationToZonedDateTime(
  operation: 'add' | 'subtract',
  zonedDateTime: TemporalZonedDateTimeObject,
  temporalDurationLike: Value,
  options: Value,
): ValueEvaluator<TemporalZonedDateTimeObject> {
  let duration = Q(yield* ToTemporalDuration(temporalDurationLike));
  if (operation === 'subtract') {
    duration = CreateNegatedTemporalDuration(duration);
  }
  const resolvedOptions = Q(GetOptionsObject(options));
  const overflow = Q(yield* GetTemporalOverflowOption(resolvedOptions));
  const calendar = zonedDateTime.Calendar;
  const timeZone = zonedDateTime.TimeZone;
  const internalDuration = ToInternalDurationRecord(duration);
  const epochNanoseconds = Q(AddZonedDateTime(zonedDateTime.EpochNanoseconds, timeZone, calendar, internalDuration, overflow));
  return X(CreateTemporalZonedDateTime(epochNanoseconds, timeZone, calendar));
}
